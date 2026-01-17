const redis = require('redis')
const Logger = require('./Logger')

const REDIS_KEY_MUTABLE = '__MUTABLE'
const REDIS_KEY_TYPE = '__TYPE'

class Cache {
    constructor(setting) {
        this.useRedis = setting.redisUrl ?? true
        this.redisClient = redis.createClient({ url: setting.redisUrl })

        this.mutableCache = []
        this.typeCache = []
    }

    async Init () {
        if (this.useRedis) {
            await this.redisClient.connect()
        }
        else {
            // do nothing
        }
    }

    async GetMutable () {
        if (this.useRedis) {
            const cacheRaw = await this.redisClient.lRange(REDIS_KEY_MUTABLE, 0, -1)
            const cache = cacheRaw.map(x => JSON.parse(x))
            return cache
        }
        else {
            return this.mutableCache
        }
    }

    async AddMutable (rows) {
        if (this.useRedis) {
            await this.redisClient.rPush(REDIS_KEY_MUTABLE, rows)
        }
        else {
            this.mutableCache.concat(rows)
        }
    }

    async GetTypes () {
        if (this.useRedis) {
            const TypeStr = await this.redisClient.get(REDIS_KEY_TYPE)
            const types = JSON.parse(TypeStr)?.sort() ?? []
            return types
        }
        else {
            return this.typeCache
        }
    }

    async SetTypes (types) {
        if (this.useRedis) {
            await this.redisClient.set(REDIS_KEY_TYPE, types)
        }
        else {
            this.typeCache = types
        }
    }

    async Size () {
        if (this.useRedis) {
            const size = await this.redisClient.dbSize()
            return size
        }
        else {
            return this.mutableCache.length
        }
    }

    async Flush () {
        if (this.useRedis) {
            await this.redisClient.flushDb()
        }
        else {
            this.mutableCache = []
            this.typeCache = []
        }
    }

    async LogCacheStates () {
        Logger.log({ level: 'info', message: `===== Cache State Start ======` })

        if (this.useRedis) {
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
        }
        else {
            for (let i = 0; i < this.mutableCache.length; ++i) {
                Logger.log({ level: 'info', message: `mutable[${i + 1}] = ${JSON.stringify(this.mutableCache[i])}` })
            }
            for (let i = 0; i < this.typeCache.length; ++i) {
                Logger.log({ level: 'info', message: `types[${i + 1}] = ${JSON.stringify(this.typeCache[i])}` })
            }
        }

        Logger.log({ level: 'info', message: `===== Cache State End ======` })
    }

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
        if (this.useRedis) {
            const existInCache = await this.redisClient.exists(id)
            return existInCache
        }
        else {
            return this.mutableCache.findIndex(x => x.id == id) >= 0
        }
    }

    async IsEntryExist (args) {
        if (this.useRedis) {
            const redisKey = this.GetRedisKey(args)
            const existInCache = await this.redisClient.exists(redisKey)
            return existInCache
        }
        else {
            return this.mutableCache.findIndex(x => {
                return x.containerType == args.containerType &&
                    x.nickname == args.nickname &&
                    x.data == args.data &&
                    x.data.title == args.data.title &&
                    x.data.href == args.data.href &&
                    x.data.i == args.data.img
            }) >= 0
        }
    }

    async AddEntry (args, updateMutable, updateTypes) {
        if (this.useRedis) {
            const redisKey = this.GetRedisKey(args)

            // update id/entry map
            await this.redisClient.set(String(args.id), redisKey)
            await this.redisClient.set(redisKey, 1)

            // update mutable cache
            if (updateMutable) {
                await this.redisClient.rPush(REDIS_KEY_MUTABLE, JSON.stringify(args))
            }
        }
        else {
            this.mutableCache.push(args)
        }

        if (!updateTypes) {
            return
        }

        if (this.useRedis) {
            const typeStr = await this.redisClient.get(REDIS_KEY_TYPE)
            const type = JSON.parse(typeStr)

            if (args.containerType && !type.includes(args.containerType)) {
                type.push(args.containerType)
                await this.redisClient.set(REDIS_KEY_TYPE, JSON.stringify(type))
                Logger.log({ level: 'info', message: `Add new type: [${args.containerType}]` })
            }
        }
        else {
            this.typeCache = [...new Set(typeCache.concat([args.containerType]))]
        }
    }

    async NoticeEntry (id) {
        if (this.useRedis) {
            const redisKey = await this.redisClient.get(String(id))

            // update mutable cache
            const mutableRaw = await this.redisClient.lRange(REDIS_KEY_MUTABLE, 0, -1)
            for (let i = 0; i < mutableRaw.length; i++) {
                const entry = JSON.parse(mutableRaw[i])
                if (entry.id == id) {
                    entry.data.isNoticed = true
                    await this.redisClient.lRem(REDIS_KEY_MUTABLE, 0, mutableRaw[i])
                    await this.redisClient.rPush(REDIS_KEY_MUTABLE, JSON.stringify(entry))
                    break
                }
            }

            return JSON.parse(redisKey)
        }
        else {
            const index = this.mutableCache.findIndex(x => x.id == id)
            if (index >= 0) {
                const matched = this.mutableCache[index]
                this.mutableCache.splice(index, 1)
                return matched
            }

            return null;
        }
    }
}

module.exports = Cache