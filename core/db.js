const { Client } = require('pg')
const Logger = require('./Logger');

class SubscriptionsDB {
	constructor (setting) {
		this.client = new Client(setting.clientSetting)
		this.table = setting.table,			
		this.client.connect()
		this.cache = []
		this.unNoticedCache = []
		this.nicknameCache = []
		this.isDirty = true

		this.queue = []

		this.InitCache(this)
		
		setInterval(this.InitCache.bind(this), 1000 * 30);

		setInterval(this.DealQuery.bind(this), 1000 * 0.5);
	}

	async InitCache()
	{
		this.isDirty = true

		Logger.log({ level: 'info', message: 'Read DB' })

		const func = (option) =>
		{
			return new Promise((resolve, reject) =>
			{	
				this.client.query(option, (err, res) => resolve(res))
			});
		}

		let query = {
			text: `SELECT * FROM ${this.table};`,
			values: [],
		}
		let result = await func(query);
		this.cache = result.rows
		
		query = {
			text: `SELECT * FROM ${this.table} WHERE isnoticed = false;`,
			values: [],
		}
		result = await func(query);
		this.unNoticedCache = result.rows
		
		query = {
			text: `SELECT DISTINCT type FROM ${this.table};`,
			values: [],
		}
		result = await func(query);
		this.nicknameCache = result.rows.map(x => x.type)

		Logger.log({ level: 'info', message: 'Read DB Done' })
		
		this.isDirty = false
	}

	DealQuery()
	{

		if (this.isDirty) return; 
		if (this.queue.length == 0) return;

		const task = this.queue.pop();
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
						message: `[${this.queue.length}] Read Entry, title = <${task.values}>`
					});
				}
				else {
					Logger.log({
						level: 'info',
						message: `Query: [${this.queue.length}]: ${JSON.stringify(task)}`
					});
				}
			}
		})
	}

	Query(option, prefix = "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;", postfix = "COMMIT;")
	{
		this.queue.push(option)
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
		const { containerType = '', nickname = '', data = {} } = args;
		if (containerType === '' || nickname === '' || data === {}) {
			Logger.log({
				level: 'error',
				message: `Invalid Entry, entry = ${JSON.stringify(args)}`
			});
			return 'Invalid Entry';
		}

		let existed = this.cache.filter(x => 
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

		if (isValid && !existed) {			
			/*await this.Query({
				text: `INSERT INTO ${this.table} (title, href, img, isNoticed, type, nickname) VALUES ($1, $2, $3, $4, $5, $6);`,
				values: [ data.title, data.href, data.img, false, containerType, nickname ],
			})*/
			await this.Query({
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
		Logger.log({ level: 'info', message: 'Get Nickname, Return cache' });
		return this.nicknameCache;
	}

	async GetContainer() {
		Logger.log({ level: 'info', message: 'Get Container, Return cache' });
		return this.ConvertToOldFormat(this.cache)
	}

	async GetUnNoticedContainers() {
		Logger.log({ level: 'info', message: 'Get unNoticed Container, Return cache' });
		const result = await this.client.query( { text: `SELECT * FROM ${this.table} WHERE isnoticed = false;` } )
		return this.ConvertToOldFormat(result.rows)
	}
}

module.exports = SubscriptionsDB;
