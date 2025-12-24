const pg = require('pg')
const redis = require('redis')
const Logger = require('./Logger')

const REDIS_KEY_MUTABLE = '__MUTABLE'
const REDIS_KEY_UNNOTICED = '__UNNOTICED'
const REDIS_KEY_TYPE = '__TYPE'

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
        this.redisClient = redis.createClient({ url: setting.redisUrl })

        this.addEntryQueue = []
        this.noticedEntryQueue = []

        // dev flag
        this.debug = process.env.SUBS_DEBUG_CACHE ?? false
        this.flushAndPreWarm = process.env.SUBS_FLUSH_CACHE ?? false
        this.movingTable = false

        // flags for log stats
        this.previousQueueCount = 0

        this.Setup(() => {
            setInterval(this.DealNoticeEntry.bind(this), 1000 * 0.01) // 10 ms
            setInterval(this.DealAddEntry.bind(this), 1000 * 0.01) // 10 ms
            setInterval(this.LogStats.bind(this), 1000 * 5) // 5 sec

            // max value ~= 25 days (2**31-1ms)
            // reference: https://stackoverflow.com/a/12633556
            setInterval(this.MoveNoticedEntriesToPersistentTable.bind(this), 1000 * 60 * 60 * 24 * 15) // 15 days
        })
    }

    // ============= Notice APIs ============= //
    async NoticeEntry (id) {
        const isExist = await this.IsIdExist(id)
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
        if (this.noticedEntryQueue.length == 0 || this.movingTable) {
            return
        }

        const id = this.noticedEntryQueue.pop()
        try {
            await this.QueryImmediate({
                text: `UPDATE ${this.mutableTable} SET ISNOTICED = true where id = $1;`,
                values: [id],
            })

            const removedMetadata = await this.RemoveUnNoticedEntry(id)
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
    }

    // ============= Add APIs ============= //
    async AddEntry (args) {
        const redisKey = this.GetRedisKey(args)
        const existInCache = await this.IsEntryExist(args)
        if (existInCache) {
            if (this.debug) {
                Logger.log({ level: 'info', message: `[AddEntry] AddEntry already exists: ${redisKey}` })
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

        Logger.log({ level: 'info', message: `[AddEntry] Add to queue: ${args.data.title}` })
        this.addEntryQueue.push(args)
    }

    async DealAddEntry () {
        if (this.addEntryQueue.length == 0 || this.movingTable) {
            return
        }

        const args = this.addEntryQueue.pop()
        const redisKey = this.GetRedisKey(args)
        const existInCache = await this.IsEntryExist(args)
        if (existInCache) {
            Logger.log({ level: 'info', message: `[DealAddEntry] AddEntry already exists: ${JSON.stringify(args)}` })
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
            await this.redisClient.del(redisKey)
            Logger.log({ level: 'info', message: `[DealAddEntry] Unable to get id: ${title}, cache may miss match` })
            return
        }

        await this.AddNewEntryToCache({ id, containerType, nickname, data })
        Logger.log({
            level: 'info',
            message: `[DealAddEntry] New Entry Added, id = ${id}, entry = ${title}`
        })

        if (this.debug) {
            await this.LogCacheStates()
        }
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
        const mutableTypes = result.rows.map(x => x.type)
        await this.redisClient.set(REDIS_KEY_MUTABLE, JSON.stringify(result.rows))

        const unNoticedEntries = result.rows.filter(x => !x.isnoticed)
        await this.redisClient.set(REDIS_KEY_UNNOTICED, JSON.stringify(unNoticedEntries))

        Logger.log({ level: 'info', message: `Cache refreshed: ${REDIS_KEY_MUTABLE} && ${REDIS_KEY_UNNOTICED}` })

        if (this.debug) {
            await this.LogCacheStates()
        }

        this.movingTable = false
    }

    async QueryImmediate (option) {
        const res = await this.pgClient.query(option.text, option.values)
        return res
    }

    async LogCacheStates () {
        Logger.log({ level: 'info', message: `===== Cache State Start ======` })

        let cursor = '0'
        let offset = 0
        do {
            const result = await this.redisClient.scan(cursor)
            for (let i = 0; i < result.keys.length; ++i) {
                const key = result.keys[i]
                const value = await this.redisClient.get(key)
                Logger.log({ level: 'info', message: `[${i + offset}] key = ${key}, value = ${value}` })
            }
            cursor = result.cursor
            offset += result.keys.length
        } while (cursor !== '0')

        Logger.log({ level: 'info', message: `===== Cache State End ======` })
    }

    async Setup (callback) {
        Logger.log({ level: 'info', message: `[Setup] debug = ${this.debug}, flushAndPreWarm = ${this.flushAndPreWarm}, MovingTable = ${this.movingTable}` })

        // initial clients
        await this.pgClient.connect()
        await this.redisClient.connect()
        Logger.log({ level: 'info', message: `[Setup] Clients initialized` })

        // update cache
        if (this.flushAndPreWarm) {
            Logger.log({ level: 'info', message: `[Setup] Start prewarm caches` })
            await this.PrewarmCache()
            Logger.log({ level: 'info', message: `[Setup] Cache prewarm finished` })
        }

        // log cache info
        {
            const mutableStr = await this.redisClient.get(REDIS_KEY_MUTABLE)
            const mutable = JSON.parse(mutableStr) ?? []

            const unNoticedStr = await this.redisClient.get(REDIS_KEY_UNNOTICED)
            const unNoticed = JSON.parse(unNoticedStr) ?? []

            const TypeStr = await this.redisClient.get(REDIS_KEY_TYPE)
            const type = JSON.parse(TypeStr)?.sort() ?? []

            const count = await this.redisClient.dbSize();

            Logger.log({ level: 'info', message: `[Setup] Cache Length: type = ${type.length}, unNoticed = ${unNoticed.length}, mutable = ${mutable.length}, totalCount = ${count}` })
            Logger.log({ level: 'info', message: `[Setup] Cache Info: type = ${JSON.stringify(type)}` })
        }

        // register workers
        callback()
        Logger.log({ level: 'info', message: `[Setup] Worker registered` })

        if (this.debug) {
            await this.LogCacheStates()
        }
        Logger.log({ level: 'info', message: `[Setup] App ready` })
    }

    async PrewarmCache () {
        // clear redis cache
        await this.redisClient.flushDb()

        let query = {
            text: `SELECT * FROM ${this.mutableTable};`,
            values: [],
        }
        let result = await this.QueryImmediate(query)

        const mutableTypes = result.rows.map(x => x.type)
        await this.redisClient.set(REDIS_KEY_MUTABLE, JSON.stringify(result.rows))

        const unNoticed = result.rows.filter(x => !x.isnoticed)
        await this.redisClient.set(REDIS_KEY_UNNOTICED, JSON.stringify(unNoticed))

        for (let i = 0; i < result.rows.length; ++i) {
            const entry = result.rows[i]
            const redisKey = this.GetRedisKey({
                id: entry.id,
                containerType: entry.type,
                nickname: entry.nickname,
                data: {
                    title: entry.title,
                    href: entry.href,
                    img: entry.img,
                    isnoticed: entry.isnoticed
                }
            })

            await this.redisClient.set(String(entry.id), redisKey)
            await this.redisClient.set(redisKey, 1)

            if (i % PREWARM_LOG_CHUNK_SIZE == 0 || i == (unNoticed.length - 1)) {
                Logger.log({ level: 'info', message: `[Cache] Add ${i + 1}/${unNoticed.length + 1} mutable entry into cache` })
            }
        }

        query = {
            text: `SELECT * FROM ${this.persistentTable};`,
            values: [],
        }
        result = await this.QueryImmediate(query)
        for (let i = 0; i < result.rows.length; ++i) {
            const entry = result.rows[i]
            const redisKey = this.GetRedisKey({
                id: entry.id,
                containerType: entry.type,
                nickname: entry.nickname,
                data: {
                    title: entry.title,
                    href: entry.href,
                    img: entry.img,
                    isnoticed: entry.isnoticed
                }
            })

            await this.redisClient.set(String(entry.id), redisKey)
            await this.redisClient.set(redisKey, 1)

            if (i % PREWARM_LOG_CHUNK_SIZE == 0 || i == (result.rows.length - 1)) {
                Logger.log({ level: 'info', message: `[Cache] Add ${i + 1}/${result.rows.length + 1} persistent entry into cache` })
            }
        }

        const persistentTypes = result.rows.map(x => x.type)
        const types = [...new Set([mutableTypes, persistentTypes].flat())]
        await this.redisClient.set(REDIS_KEY_TYPE, JSON.stringify(types))
    }

    async GetContainerTypes () {
        Logger.log({ level: 'info', message: `GetContainerTypes` })
        const cacheStr = await this.redisClient.get(REDIS_KEY_TYPE)
        const cache = JSON.parse(cacheStr)
        return cache
    }

    // ============= Get APIs =============
    async GetContainers () {
        Logger.log({ level: 'info', message: 'GetContainers' })
        const cacheStr = await this.redisClient.get(REDIS_KEY_MUTABLE)
        const cache = JSON.parse(cacheStr)

        const types = await this.GetContainerTypes()
        const container = []

        for (const entry of cache) {
            const type = entry.type
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
    GetRedisKey (args) {
        // { containerType, nickname, data } -> string
        return JSON.stringify({
            containerType: args?.containerType ?? 'unknown',
            nickname: args?.nickname ?? 'unknown',
            title: args?.data?.title ?? 'unknown',
            img: args?.data?.img ?? 'NULL',
            href: args?.data?.href ?? 'unknown',
        })
    }

    async IsIdExist (id) {
        const existInCache = await this.redisClient.exists(id)
        return existInCache
    }

    async IsEntryExist (args) {
        const redisKey = this.GetRedisKey(args)
        const existInCache = await this.redisClient.exists(redisKey)
        return existInCache
    }

    async AddNewEntryToCache (args) {
        const redisKey = this.GetRedisKey(args)

        // update id map
        await this.redisClient.set(String(args.id), redisKey)

        // update entry map
        await this.redisClient.set(redisKey, 1)
        console.log(`set redisKey = ${redisKey}`)

        // update unnoticed cache
        const currentUnNoticedStr = await this.redisClient.get(REDIS_KEY_UNNOTICED)
        const currentUnNoticed = JSON.parse(currentUnNoticedStr)
        currentUnNoticed.push(args)
        await this.redisClient.set(REDIS_KEY_UNNOTICED, JSON.stringify(currentUnNoticed))

        // update mutable cache
        const mutableStr = await this.redisClient.get(REDIS_KEY_MUTABLE)
        const mutable = JSON.parse(mutableStr)
        mutable.push(args)
        await this.redisClient.set(REDIS_KEY_MUTABLE, JSON.stringify(mutable))

        // update type
        const typeStr = await this.redisClient.get(REDIS_KEY_TYPE)
        const type = JSON.parse(typeStr)

        if (args.containerType && !type.includes(args.containerType)) {
            type.push(args.containerType)
            await this.redisClient.set(REDIS_KEY_TYPE, JSON.stringify(type))
            Logger.log({ level: 'info', message: `Add new type: [${args.containerType}]` })
        }
    }

    async RemoveUnNoticedEntry (id) {
        const redisKey = await this.redisClient.get(String(id))

        // update id map
        await this.redisClient.del(String(id))

        // update unnoticed cache
        const currentUnNoticedStr = await this.redisClient.get(REDIS_KEY_UNNOTICED)
        const currentUnNoticed = JSON.parse(currentUnNoticedStr)
        for (let i = 0; i < currentUnNoticed.length; i++) {
            if (currentUnNoticed[i].id == id) {
                currentUnNoticed.splice(i, 1)
                break
            }
        }
        await this.redisClient.set(REDIS_KEY_UNNOTICED, JSON.stringify(currentUnNoticed))

        // update mutable cache
        const mutableStr = await this.redisClient.get(REDIS_KEY_MUTABLE)
        const mutable = JSON.parse(mutableStr)
        for (let i = 0; i < mutable.length; i++) {
            if (mutable[i].id == id) {
                mutable[i].isnoticed = true
                break
            }
        }
        await this.redisClient.set(REDIS_KEY_MUTABLE, JSON.stringify(mutable))

        return JSON.parse(redisKey)
    }
}

module.exports = SubscriptionsDB
