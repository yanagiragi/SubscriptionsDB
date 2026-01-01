const pg = require('pg')
const Cache = require('./cache')
const Logger = require('./Logger')

const PREWARM_LOG_CHUNK_SIZE = 1000

class SubscriptionsDB {
    constructor(setting) {
        // There are two tables:
        //    mutableTable: entry that is not noticed or noticed but not moved to persistentTable yet.
        //    persistentTable: read-only data that has been noticed, only used to check if an entry has already been added.
        this.mutableTable = setting.mutableTable
        this.persistentTable = setting.persistentTable

        // setup client
        this.pgClient = new pg.Client(setting.clientSetting)

        this.addEntryQueue = []
        this.noticedEntryQueue = []

        this.cache = new Cache(setting)

        // dev flag
        this.debug = process.env.SUBS_DEBUG_CACHE ?? false
        this.flushAndPreWarm = process.env.SUBS_FLUSH_CACHE ?? false
        this.movingTable = false

        // flags for log stats
        this.previousQueueCount = -1

        this.isDealingAddEntry = false
        this.isDealingNoticeEntry = false

        this.isReady = false
    }

    async Init () {
        return this.Setup(() => {
            setInterval(this.DealNoticeEntry.bind(this), 1000 * 0.01) // 10 ms
            setInterval(this.DealAddEntry.bind(this), 1000 * 0.01) // 10 ms
            setInterval(this.LogStats.bind(this), 1000 * 5) // 5 sec

            // max value ~= 25 days (2**31-1ms)
            // reference: https://stackoverflow.com/a/12633556
            setInterval(this.MoveNoticedEntriesToPersistentTable.bind(this), 1000 * 60 * 60 * 24 * 15) // 15 days

            this.isReady = true
        })
    }

    // ============= Notice APIs ============= //
    async NoticeEntry (id) {
        const isExist = await this.cache.IsIdExist(id)
        if (!isExist) {
            Logger.log({
                level: 'error',
                message: `Detect ${id} does not exist in cache. Skipped`
            })
            return
        }

        Logger.log({ level: 'info', message: `NoticeEntry add to queue: [${id}]` })
        this.noticedEntryQueue.push(id)
    }

    async DealNoticeEntry () {
        if (this.noticedEntryQueue.length == 0 || this.movingTable || this.isDealingNoticeEntry) {
            return
        }

        this.isDealingNoticeEntry = true

        const id = this.noticedEntryQueue.pop()
        try {
            await this.QueryImmediate({
                text: `UPDATE ${this.mutableTable} SET ISNOTICED = true where id = $1;`,
                values: [id],
            })

            const removedMetadata = await this.cache.RemoveEntry(id)
            Logger.log({
                console: 'true',
                level: 'info',
                message: `Read ${id}: [${removedMetadata?.containerType}] <${removedMetadata?.title}>`
            })
        }
        catch (err) {
            Logger.log({
                level: 'error',
                message: `Error with ContainerId <${id}>. err = ${err}, stack = ${err.stack}`
            })
        }

        if (this.debug) {
            await this.LogCacheStates()
        }

        this.isDealingNoticeEntry = false
    }

    // ============= Add APIs ============= //
    async AddEntry (args) {
        const existInCache = await this.cache.IsEntryExist(args)
        if (existInCache) {
            if (this.debug) {
                Logger.log({ level: 'info', message: `[AddEntry] AddEntry already exists: ${JSON.stringify(args)}` })
            }
            return
        }

        const GetInvalidReason = args => {
            if (!args.data) return 'Missing data'
            if (!args.containerType) return 'Missing containerType'
            if (!args.nickname) return 'Missing nickname'
            if (!args.data.title) return 'Missing data.title'
            if (!args.data.href) return 'Missing data.hre'
            if (!args.data.img) return 'Missing data.img'
            return 'Unknown'
        }

        const isArgsValid = args.containerType &&
            args.nickname &&
            args.data &&
            args.data.title &&
            args.data.href &&
            args.data.img
        if (!isArgsValid) {
            Logger.log({
                level: 'error',
                message: `[AddEntry] Invalid Entry, reason = ${GetInvalidReason(args)}, entry = ${JSON.stringify(args)}`
            })
            return 'Invalid Entry'
        }

        if (this.debug) {
            Logger.log({ level: 'info', message: `[AddEntry] Add to queue: ${args.data.title}` })
        }
        this.addEntryQueue.push(args)
    }

    async DealAddEntry () {
        if (this.addEntryQueue.length == 0 || this.movingTable || this.isDealingAddEntry) {
            return
        }

        this.isDealingAddEntry = true

        const args = this.addEntryQueue.pop()
        const existInCache = await this.cache.IsEntryExist(args)
        if (existInCache) {
            Logger.log({ level: 'info', message: `[DealAddEntry] AddEntry already exists: ${JSON.stringify(args)}` })
            this.isDealingAddEntry = false
            return
        }

        const { containerType, nickname, data } = args
        const { title, href, img } = data
        const result = await this.QueryImmediate({
            text: `INSERT INTO ${this.mutableTable} (title, href, img, isNoticed, type, nickname) SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS ( SELECT 1 FROM ${this.mutableTable} WHERE title = $7 AND href = $8 AND img = $9 AND type = $10 AND nickname = $11 ) RETURNING id;`,
            values: [title, href, img, false, containerType, nickname, title, href, img, containerType, nickname],
        })

        const id = result.rows?.[0]?.id
        if (!id) {
            Logger.log({ level: 'info', message: `[DealAddEntry] Unable to get id: ${title}, cache may miss match` })
            this.isDealingAddEntry = false
            return
        }

        await this.cache.AddEntry({ id, containerType, nickname, data }, true)
        Logger.log({
            level: 'info',
            message: `[DealAddEntry] New Entry Added, id = ${id}, entry = ${title}`
        })

        if (this.debug) {
            await this.LogCacheStates()
        }

        this.isDealingAddEntry = false
    }

    // ============= Internal APIs ============= //
    LogStats () {
        const totalQueueCount = this.addEntryQueue.length + this.noticedEntryQueue.length
        if (totalQueueCount == 0 && this.previousQueueCount == 0) {
            return
        }

        this.previousQueueCount = totalQueueCount
        Logger.log({
            level: 'info',
            message: `AddEntryQueue = ${this.addEntryQueue.length}, NoticedEntryQueue = ${this.noticedEntryQueue.length}`
        })
    }

    async MoveNoticedEntriesToPersistentTable () {
        this.movingTable = true
        let query = {
            text: `WITH moved AS ( DELETE FROM ${this.mutableTable} WHERE isnoticed = true RETURNING * ) INSERT INTO ${this.persistentTable} (id, type, nickname, title, href, img) SELECT id, type, nickname, title, href, img FROM moved;`,
            values: [],
        }
        let result = await this.QueryImmediate(query)
        Logger.log({ level: 'info', message: `Move Noticed Entries To Persistent Table.` })

        query = {
            text: `SELECT * FROM ${this.mutableTable};`,
            values: [],
        }
        result = await this.QueryImmediate(query)
        await this.cache.AddMutable(result.rows.map(x => JSON.stringify(x)))
        Logger.log({ level: 'info', message: `Cache refreshed` })

        if (this.debug) {
            await this.LogCacheStates()
        }

        this.movingTable = false
    }

    async QueryImmediate (option) {
        const res = await this.pgClient.query(option.text, option.values)
        return res
    }

    async Setup (callback) {
        Logger.log({ level: 'info', message: `[Setup] debug = ${this.debug}, flushAndPreWarm = ${this.flushAndPreWarm}, MovingTable = ${this.movingTable}` })

        // initial clients
        await this.pgClient.connect()
        await this.cache.Init()
        Logger.log({ level: 'info', message: `[Setup] Clients initialized` })

        // update cache
        if (this.flushAndPreWarm) {
            Logger.log({ level: 'info', message: `[Setup] Start prewarm caches` })
            await this.PrewarmCache()
            Logger.log({ level: 'info', message: `[Setup] Cache prewarm finished` })
        }

        // log cache info
        {
            const mutable = await this.cache.GetMutable()
            const unNoticed = mutable.filter(x => !x.isnoticed)
            const type = await this.cache.GetTypes()
            const count = await this.cache.Size()

            Logger.log({ level: 'info', message: `[Setup] Cache Length: type = ${type.length}, unNoticed = ${unNoticed.length}, mutable = ${mutable.length}, totalCount = ${count}` })
            Logger.log({ level: 'info', message: `[Setup] Cache Info: type = ${JSON.stringify(type)}` })
        }

        if (this.debug) {
            await this.cache.LogCacheStates()
        }

        // register workers
        Logger.log({ level: 'info', message: `[Setup] Worker registered` })

        Logger.log({ level: 'info', message: `[Setup] App ready` })

        callback()
    }

    async PrewarmCache () {
        const AddEntry = async rows => {
            for (let i = 0; i < rows.length; ++i) {
                const entry = rows[i]
                await this.cache.AddEntry({
                    id: entry.id,
                    containerType: entry.type,
                    nickname: entry.nickname,
                    data: {
                        title: entry.title,
                        href: entry.href,
                        img: entry.img,
                        isnoticed: entry.isnoticed
                    }
                }, false)
                if (i % PREWARM_LOG_CHUNK_SIZE == 0 || i == (rows.length - 1)) {
                    Logger.log({ level: 'info', message: `[Cache] Add ${i + 1}/${rows.length + 1} mutable entry into cache` })
                }
            }
        }

        await this.cache.Flush()
        Logger.log({ level: 'info', message: `[Cache] Flush cache complete` })

        // update key & id cache
        const mutableResults = await this.QueryImmediate({
            text: `SELECT * FROM ${this.mutableTable};`,
            values: [],
        })
        Logger.log({ level: 'info', message: `[Cache] Add mutable rows into entries...` })
        await AddEntry(mutableResults.rows)
        Logger.log({ level: 'info', message: `[Cache] Add mutable rows into entries done` })

        const persistentResults = await this.QueryImmediate({
            text: `SELECT * FROM ${this.persistentTable};`,
            values: [],
        })
        Logger.log({ level: 'info', message: `[Cache] Add persistent rows into entries...` })
        await AddEntry(persistentResults.rows)
        Logger.log({ level: 'info', message: `[Cache] Add persistent rows into entries done` })

        // update mutable cache
        await this.cache.AddMutable(persistentResults.rows.map(x => {
            const transformed = {
                containerType: x.type,
                nickname: x.nickname,
                title: x.title,
                href: x.href,
                img: x.img,
                isnoticed: x.isnoticed,
            }
            return JSON.stringify(transformed)
        }))

        // update type cache
        const mutableTypes = mutableResults.rows.map(x => x.type)
        const persistentTypes = persistentResults.rows.map(x => x.type)
        const types = [...new Set([mutableTypes, persistentTypes].flat())]
        await this.cache.SetTypes(JSON.stringify(types))
    }

    async GetContainerTypes () {
        Logger.log({ level: 'info', message: `GetContainerTypes` })
        if (!this.isReady) {
            return []
        }
        const cache = await this.cache.GetTypes()
        return cache
    }

    // ============= Get APIs =============
    async GetContainers () {
        Logger.log({ level: 'info', message: 'GetContainers' })
        if (!this.isReady) {
            return []
        }
        const cache = await this.cache.GetMutable()
        const types = await this.GetContainerTypes()
        const container = []

        for (const entry of cache) {
            const type = entry.containerType
            const typeIdx = types.indexOf(type)
            const containerIdx = container.findIndex(x => x.typeId === typeIdx && x.nickname === entry.nickname);

            if (containerIdx == -1) {
                container.push({
                    type,
                    typeId: typeIdx,
                    nickname: entry.nickname,
                    list: [entry]
                })
            }
            else {
                container[containerIdx].list.push(entry)
            }
        }

        for (const key in container) {
            container[key].list = container[key].list.sort((_x, _y) => _x.title > _y.title)
        }

        return {
            types, container
        }
    }

    async GetContainersWithFilter (type, nickname) {
        Logger.log({ level: 'info', message: `GetContainersWithFilter: [${type}] - [${nickname}]` })
        if (!this.isReady) {
            return {
                types: [],
                container: []
            }
        }
        const data = await this.GetContainers()
        const matched = data.container.filter(x => data.types[x.typeId] == type && x.nickname == nickname)
        return {
            types: data.types,
            container: matched
        }
    }

    async GetUnNoticedContainers () {
        Logger.log({ level: 'info', message: 'GetUnNoticedContainers' })
        const data = await this.GetContainers()
        for (const container of data.container) {
            container.list = container.list.filter(x => !x.isnoticed)
        }
        return {
            types: data.types,
            container: data.container.filter(x => x.list.length > 0)
        }
    }

    // ============= Caches =============

}

module.exports = SubscriptionsDB
