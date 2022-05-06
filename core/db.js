const { Client } = require('pg')
const Logger = require('./Logger');

class SubscriptionsDB {
	constructor (setting) {
		this.table = setting.table,
		this.noticedTable = setting.noticedTable,
		
		// setup client
		this.client = new Client(setting.clientSetting)
		this.client.connect()
		
		this.cache = []
		this.unNoticedCache = []
		this.noticedCache = []
		this.nicknameCache = []
		
		this.isDirty = true
		this.isNoticedCacheDirty = true
		this.noticedEntryMaximumAllowance = 1000

		this.lastUpdateTime = Date.now()
		this.cacheLiveTime = 1000 * 30
		
		this.queue = []
		this.addEntryQueue = []

		this.UpdateCache()

		//setInterval(this.UpdateCache.bind(this), 1000 * 30);

		setInterval(this.DealQuery.bind(this), 1000 * 0.01);
		setInterval(this.DealAddEntry.bind(this), 5);

		setInterval(
			() => {
				if ((this.queue.length + this.addEntryQueue.length) == 0) return ;
				Logger.log({ level: 'info', message: `Queue = ${this.queue.length}, AddEntryQueue = ${this.addEntryQueue.length}` })
			}, 1000 * 5)
	}

	async MoveNoticedEntryToNoticedTable()
	{
		const query = {
			text: `WITH moved AS ( DELETE FROM ${this.table} WHERE isnoticed = true RETURNING * ) INSERT INTO ${this.noticedTable} (id, type, nickname, title, href, img) SELECT id, type, nickname, title, href, img FROM moved;`,
			values: [],
		}
		
		return this.QueryImmediate(query)
	}

	
	async UpdateCache()
	{
		this.isDirty = true

		Logger.log({ level: 'info', message: 'Read DB' })
		
		let query = {text: ``, values: []}
		let result = null
		
		query = {
			text: `SELECT * FROM ${this.table};`,
			values: [],
		}
		result = await this.QueryImmediate(query);
		this.cache = result.rows
		
		query = {
			text: `SELECT * FROM ${this.table} WHERE isnoticed = false;`,
			values: [],
		}
		result = await this.QueryImmediate(query);
		this.unNoticedCache = result.rows
		
		const noticedEntryCount = this.cache.length - this.unNoticedCache.length
		Logger.log({ level: 'info', message: `cache length = ${this.cache.length}, unNoticedCache length = ${this.unNoticedCache.length}, difference = ${noticedEntryCount}` })
		
		if (noticedEntryCount >= this.noticedEntryMaximumAllowance) {
			Logger.log({ level: 'info', message: `Detect noticed entry count ${noticedEntryCount} exceeds noticed_Entry_Maximum_Allowance, start moving noticed entry to noticedTable.` })
			this.isNoticedCacheDirty =  true
			await this.MoveNoticedEntryToNoticedTable()
		}
		
		const nicknames = [...this.cache, ...this.noticedCache].map(x => x.type)
		this.nicknameCache = [...new Set(nicknames)]

		if (this.noticedCache == null || this.isNoticedCacheDirty) {
			query = {
				text: `SELECT * FROM ${this.noticedTable};`,
				values: [],
			}
			result = await this.QueryImmediate(query);
			this.noticedCache = result.rows
			this.isNoticedCacheDirty = false
		}

		Logger.log({ level: 'info', message: `Read DB Done. Status: (cache: ${this.cache.length}, noticed: ${this.noticedCache.length}), unNoticed: ${this.unNoticedCache.length}, nickname: ${this.nicknameCache.length}` })

		this.isDirty = false
		this.isNoticedCacheDirty = false
	}

	DealQuery()
	{
		if (this.isDirty) return; 
		if (this.queue.length == 0) return;

		const now = Date.now()
		const diff = now - this.lastUpdateTime
		if (diff > this.cacheLifeTime) {
			this.lastUpdateTime = now
			this.UpdateCache()
		}

		const { task, callback } = this.queue.pop();
		if (task == null) return;
		Logger.log({ level: 'info', message: `Query: [${JSON.stringify(task)}]` });
		this.client.query(task, (err, res) => {
			if (err) {
				this.queue.push(task)
			}
			else {
				if (task.text.indexOf('INSERT') == 0)
				{
					Logger.log({
						level: 'info',
						message: `[${this.queue.length}] Add New Entry, title = <${task.values[0]}>`
					});
				}
				else if (task.text.indexOf('UPDATE') == 0)
				{
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

				callback(res)
			}
		})
	}

	async Query(option, prefix = "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;", postfix = "COMMIT;")
	{
		Logger.log({ level: 'info', message: `Query: [${JSON.stringify(option)}]` });
		return new Promise((resolve, reject) => {
			this.queue.push({ 'task': option, 'callback': resolve })
		})
	}
	
	async QueryImmediate(option)
	{
		return new Promise((resolve, reject) =>
		{
			this.client.query(option, (err, res) => resolve(res))
		});
	}

	/*
    	*	Params:
	*		containerId: container.container 中的 Index
	*		listId: container.container[index].list 的 Index
	*
	*/
	async NoticeEntry (id) {
		const result = await this.Query({
			text: `UPDATE ${this.table} SET ISNOTICED = true where id = $1;`,
			values: [ id ],
		})
		const isEntryExists = result.rowCount && result.rowCount > 0;
		if (isEntryExists) {
			const isEntryExistsInCache = this.cache.filter(x => x.id == id).length > 0
			let title = ''
			if (!isEntryExistsInCache) {
				const result = await this.Query({
					text: `SELECT * FROM ${this.table} where id = $1;`,
					values: [ id ],
				})
				title = result.rows[0].title
			}
			else {
				title = this.cache.filter(x => x.id == id)[0].title
			}

			Logger.log({
				console: 'true',
				level: 'info',
				message: `Read ContainerId <${id}>: ${title}`
			});
		} else {
			Logger.log({
				level: 'error',
				message: `Error with ContainerId <${id}>`
			});
		}
	}

	async AddEntry (args) {
		this.addEntryQueue.push(args)
	}

	async DealAddEntry () {
		
		if (this.isDirty) { /*console.log('Detect Dirty When Try Deal AddEntry(), waiting...');*/ return; } 
		if (this.addEntryQueue.length == 0) return;

		//console.log('Deal AddEntry(), length = ' + this.addEntryQueue.length);

		const args = this.addEntryQueue.pop();
		
		const { containerType = '', nickname = '', data = {} } = args;
		if (containerType === '' || nickname === '' || data === {}) {
			Logger.log({
				level: 'error',
				message: `Invalid Entry, entry = ${JSON.stringify(args)}`
			});
			return 'Invalid Entry';
		}


		// this.cache may not be ready

		let existed = this.cache.filter(x => 
				x.title == data.title &&
				x.nickname == nickname &&
				x.href == data.href &&
				x.img == data.img
			).length > 0
			||
			this.noticedCache.filter(x => 
				x.title == data.title &&
				x.nickname == nickname &&
				x.href == data.href &&
				x.img == data.img
			).length > 0;
		/*if (existed == false) {
			const result = await this.Query({
				text: `SELECT * FROM ${this.table} WHERE nickname = $1 AND title = $2 AND href = $3 AND img = $4;`,
				values: [ nickname, data.title, data.href, data.img ],
			})
			existed = result.rowCount && result.rowCount > 0;
		}*/
		/*else { 
			Logger.log({
				level: 'info',
				message: `Detect existed Entry in Cache: ${this.cache.filter(x =>
		                        x.title == data.title &&
		                        x.nickname == nickname &&
		                        x.href == data.href &&
		                        x.img == data.img
		                        )[0].title}, Skip.`
			});
		}*/

		const isValid = data && data.title && data.href && data.img;

		if (isValid != null && !existed) {
			this.Query({
				text: `INSERT INTO ${this.table} (title, href, img, isNoticed, type, nickname) SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS ( SELECT 1 FROM ${this.table} WHERE title = $7 AND href = $8 AND img = $9 AND type = $10 AND nickname = $11 );`,
				values: [ data.title, data.href, data.img, false, containerType, nickname, data.title, data.href, data.img, containerType, nickname ],
			})
		} else {
			if (existed) {
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

	async ConvertToOldFormat(result)
	{
		const types = await this.GetContainerTypes()
		const nicknames = [...new Set(result.map(x => x.nickname))]

		const parsed = 
		{
			types: types,
			container: []
		}
		
		for(const row of result)
		{
			var typeIdx = parsed.types.indexOf(row.type);
			var containerIdx = parsed.container.findIndex(x => x.typeId === typeIdx && x.nickname === row.nickname);

			if (containerIdx == -1) {
				parsed.container.push({
					typeId: typeIdx,
					nickname: row.nickname,
					list: [ row ]
				})
			}
			else
			{
				parsed.container[containerIdx].list.push(row)
			}
		}
		
		return parsed
	}

	async GetContainerTypes () {
		Logger.log({ level: 'info', message: 'Get Nickname, Return cache' + JSON.stringify(this.nicknameCache) });
		return this.nicknameCache;
	}

	async GetContainers() {
		Logger.log({ level: 'info', message: 'Get Container, Return cache' });
		return this.ConvertToOldFormat(this.cache)
	}
	
	async GetContainersWithFilter(type, nickname) {
		Logger.log({ level: 'info', message: `Get Container with filter, Return filtered cache of [${type}] - [${nickname}]` });
		const types = await this.GetContainerTypes()
		const matched = this.cache.filter(x => x.type == type && x.nickname == nickname);
		return this.ConvertToOldFormat(matched)
	}

	async GetUnNoticedContainers() {
		Logger.log({ level: 'info', message: 'Get unNoticed Container, Return cache' });
		const result = await this.client.query( { text: `SELECT * FROM ${this.table} WHERE isnoticed = false;` } )
		return this.ConvertToOldFormat(result.rows)
	}
}

module.exports = SubscriptionsDB;
