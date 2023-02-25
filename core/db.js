const { Client } = require('pg')
const Logger = require('./Logger');

class SubscriptionsDB {

    constructor(setting) {

        // There are two tables:
        //    mutableTable: entry that is not noticed or noticed but not moved to persistentTable yet.
        //    persistentTable: read-only data that has been noticed
        this.mutableTable = setting.mutableTable
        this.persistentTable = setting.persistentTable

        // setup client
        this.client = new Client(setting.clientSetting)
        this.client.connect()

        // data that stores in mutable table
        this.mutableEntries = null

        // unNoticed entry in this.mutableCache
        this.unNoticedEntries = null

        // data that stores in persistent table
        this.persistentEntries = null

        // types in this.mutableCache and this.persistentCache
        this.typeCache = null

        this.queue = []
        this.addEntryQueue = []

        this.isMutableEntriesDirty = false
        this.isPersistentEntriesDirty = false

        // how many mutable entries will trigger move noticed entries into persistent entries
        this.maximumMutableEntriesCount = 1000

        this.lastUpdateTime = Date.now()
        this.cacheLifeTime = 1000 * 30 // how often we're updating the cache

        // flags for log stats
        this.previousQueueCount = 0

        // update cache immediate
        this.UpdateCache()

        setInterval(this.DealQuery.bind(this), 1000 * 0.01)
        setInterval(this.DealAddEntry.bind(this), 1000 * 0.01)
        setInterval(this.CheckAndLogStats.bind(this), 1000 * 5)
    }

    // ============= Internal APIs ============= //

    CheckAndLogStats() {
        const totalQueueCount = this.queue.length + this.addEntryQueue.length
        if (totalQueueCount == 0 && this.previousQueueCount == 0) {
            return;
        }

        this.previousQueueCount = totalQueueCount
        Logger.log({
            level: 'info',
            message: `Queue = ${this.queue.length}, AddEntryQueue = ${this.addEntryQueue.length}`
        })
    }

    async MoveNoticedEntriesToPersistentTable() {
        const query = {
            text: `WITH moved AS ( DELETE FROM ${this.mutableTable} WHERE isnoticed = true RETURNING * ) INSERT INTO ${this.persistentTable} (id, type, nickname, title, href, img) SELECT id, type, nickname, title, href, img FROM moved;`,
            values: [],
        }
        return this.QueryImmediate(query)
    }

    async UpdateCache() {
        this.isMutableEntriesDirty = true
        Logger.log({ level: 'info', message: 'Read DB' })

        let query = { text: ``, values: [] }
        let result = null

        query = {
            text: `SELECT * FROM ${this.mutableTable};`,
            values: [],
        }
        result = await this.QueryImmediate(query);
        this.mutableEntries = result.rows

        query = {
            text: `SELECT * FROM ${this.mutableTable} WHERE isnoticed = false;`,
            values: [],
        }
        result = await this.QueryImmediate(query);
        this.unNoticedEntries = result.rows

        const noticedEntryCount = this.mutableEntries.length - this.unNoticedEntries.length
        Logger.log({ level: 'info', message: `cache length = ${this.mutableEntries.length}, unNoticedCache length = ${this.unNoticedEntries.length}, difference = ${noticedEntryCount}` })

        if (noticedEntryCount >= this.maximumMutableEntriesCount) {
            Logger.log({ level: 'info', message: `Detect noticed entry count ${noticedEntryCount} exceeds noticed_Entry_Maximum_Allowance, start moving noticed entry to noticedTable.` })
            this.isPersistentEntriesDirty = true
            await this.MoveNoticedEntriesToPersistentTable()
        }

        if (this.persistentEntries == null || this.isPersistentEntriesDirty) {
            query = {
                text: `SELECT * FROM ${this.persistentTable};`,
                values: [],
            }
            result = await this.QueryImmediate(query);
            this.persistentEntries = result.rows
            this.isPersistentEntriesDirty = false
        }

        const types = [...this.mutableEntries, ...this.persistentEntries].map(x => x.type)
        this.typeCache = [...new Set(types)]

        Logger.log({
            level: 'info',
            message: `Read DB Done. Status: (cache: ${this.mutableEntries.length}, noticed: ${this.persistentEntries.length}), unNoticed: ${this.unNoticedEntries.length}, types: ${this.typeCache.length}`
        })

        this.isMutableEntriesDirty = false
        this.isPersistentEntriesDirty = false
    }

    async Query(option) {
        // const prefix = "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;"
        // const postfix = "COMMIT;"
        Logger.log({
            level: 'info',
            message: `Query: [${JSON.stringify(option)}]`
        });
        return new Promise((resolve, reject) => {
            this.queue.push({
                'task': option, 'callback': (err, res) => {
                    if (err) {
                        reject(err)
                    }
                    else {
                        resolve(res)
                    }
                }
            })
        })
    }

    async QueryImmediate(option) {
        return new Promise((resolve, reject) => {
            this.client.query(option, (err, res) => {
                if (err) {
                    reject(err)
                }
                else {
                    resolve(res)
                }
            })
        });
    }

    DealQuery() {
        if (this.isMutableEntriesDirty || this.queue.length == 0) {
            return;
        }

        const now = Date.now()
        const diff = now - this.lastUpdateTime
        if (diff > this.cacheLifeTime) {
            this.lastUpdateTime = now
            this.UpdateCache()
            return
        }

        if (this.isMutableEntriesDirty || this.isPersistentEntriesDirty) {
            return
        }

        const { task, callback } = this.queue.pop();
        if (task == null) {
            return;
        }

        Logger.log({ level: 'info', message: `Query: [${JSON.stringify(task)}]` });
        this.client.query(task, (err, res) => {
            if (err) {
                this.queue.push(task)
            }
            else {
                if (task.text.indexOf('INSERT') == 0) {
                    Logger.log({
                        level: 'info',
                        message: `[${this.queue.length}] Add New Entry, title = <${task.values[0]}>`
                    });
                }
                else if (task.text.indexOf('UPDATE') == 0) {
                    Logger.log({
                        level: 'info',
                        message: `[${this.queue.length}] Read Entry, id = <${task.values}>`
                    });
                }
                else {
                    Logger.log({
                        level: 'info',
                        message: `Query: [${this.queue.length}]: ${JSON.stringify(task)}`
                    });
                }

                callback(err, res)
            }
        })
    }

    // ============= Notice APIs ============= //

    async NoticeEntry(id) {

        const matched = this.mutableEntries.filter(x => x.id == id)?.[0]
        if (matched == null) {
            Logger.log({
                level: 'warning',
                message: `Detect ${id} does not exist in mutableCache.`
            });
        }
        else {
            matched.isNoticed = true

            // update this.unNoticedEntriesCache
            const idx = this.unNoticedEntries?.findIndex(x => x.id == id) ?? -1
            if (idx != -1) {
                this.unNoticedEntries.splice(idx, 1)
            }
        }

        try {
            await this.Query({
                text: `UPDATE ${this.mutableTable} SET ISNOTICED = true where id = $1;`,
                values: [id],
            })
            Logger.log({
                console: 'true',
                level: 'info',
                message: `Read ContainerId <${id}>: ${matched?.title}`
            });
        }
        catch (err) {
            Logger.log({
                level: 'error',
                message: `Error with ContainerId <${id}>. Raw = ${JSON.stringify(err)}`
            });
        }
    }

    // ============= Add APIs ============= //

    async AddEntry(args) {
        this.addEntryQueue.push(args)
    }

    async DealAddEntry() {

        if (this.isMutableEntriesDirty) {
            return;
        }

        if (this.addEntryQueue.length == 0) {
            return;
        }

        const args = this.addEntryQueue.pop();
        const { containerType = '', nickname = '', data = {} } = args;
        if (containerType === '' || nickname === '' || data === {}) {
            Logger.log({
                level: 'error',
                message: `Invalid Entry, entry = ${JSON.stringify(args)}`
            });
            return 'Invalid Entry';
        }

        const matchEntry = (source, target) => {
            return source.title == target.title &&
                source.nickname == target.nickname &&
                source.href == target.href &&
                source.img == target.img
        }
        const ContainsEntry = (collection, target) => collection.some(x => matchEntry(x, target))

        const entryToBeAdd = Object.assign(data, { nickname });
        const isEntryAlreadyExisted = [this.mutableEntries, this.persistentEntries].some(x => ContainsEntry(x, entryToBeAdd))
        const isValid = data && data.title && data.href && data.img;

        if (isValid != null && !isEntryAlreadyExisted) {
            this.Query({
                text: `INSERT INTO ${this.mutableTable} (title, href, img, isNoticed, type, nickname) SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS ( SELECT 1 FROM ${this.mutableTable} WHERE title = $7 AND href = $8 AND img = $9 AND type = $10 AND nickname = $11 );`,
                values: [data.title, data.href, data.img, false, containerType, nickname, data.title, data.href, data.img, containerType, nickname],
            })
        } else {
            if (isEntryAlreadyExisted) {
                Logger.log({
                    level: 'debug',
                    message: `Entry existed, title = <${data.title}>`
                });
            } else {
                if (data) {
                    Logger.log({
                        level: 'error',
                        message: `Missing entry: <${data.title || null}, ${data.href || null}, ${data.img || null}, ${data.isNoticed || null}>`
                    });
                } else {
                    Logger.log({
                        level: 'error',
                        message: `Missing entry: <${data || null}>`
                    });
                }
            }
        }
    }

    // ============= Get APIs =============

    async ConvertToOldFormat(result) {
        const types = await this.GetContainerTypes()
        const parsed =
        {
            types: types,
            container: []
        }

        for (const row of result) {
            var typeIdx = parsed.types.indexOf(row.type);
            var containerIdx = parsed.container.findIndex(x => x.typeId === typeIdx && x.nickname === row.nickname);

            if (containerIdx == -1) {
                parsed.container.push({
                    typeId: typeIdx,
                    nickname: row.nickname,
                    list: [row]
                })
            }
            else {
                parsed.container[containerIdx].list.push(row)
            }
        }

        return parsed
    }

    async GetContainerTypes() {
        Logger.log({ level: 'info', message: 'Get Nickname, Return cache' + JSON.stringify(this.typeCache) });
        return this.typeCache;
    }

    async GetContainers() {
        Logger.log({ level: 'info', message: 'Get Container, Return cache' });
        return this.ConvertToOldFormat(this.mutableEntries)
    }

    async GetContainersWithNickname(type, nickname) {
        Logger.log({ level: 'info', message: `Get Container with filter, Return filtered cache of [${type}] - [${nickname}]` });
        const matched = this.mutableEntries.filter(x => x.type == type && x.nickname == nickname);
        return this.ConvertToOldFormat(matched)
    }

    async GetUnNoticedContainers() {
        Logger.log({ level: 'info', message: 'Get unNoticed Container, Return cache' });
        return this.ConvertToOldFormat(this.unNoticedEntries)
    }
}

module.exports = SubscriptionsDB;
