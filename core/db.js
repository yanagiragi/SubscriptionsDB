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

		this.InitCache(this)
		setInterval( () => this.InitCache(this), 1000 * 30);
	}

	async InitCache(db)
	{
		let query = {
			text: `SELECT * FROM ${this.table};`,
			values: [],
		}
		let result = await db.Query(query)
		db.cache = result.rows
		
		query = {
			text: `SELECT * FROM ${this.table} WHERE isnoticed = false;`,
			values: [],
		}
		result = await db.Query(query)
		db.unNoticedCache = result.rows
		
		query = {
			text: `SELECT DISTINCT type FROM ${this.table};`,
			values: [],
		}
		result = await db.Query(query)
		db.nicknameCache = result.rows
	}

	Query(option)
	{
		return new Promise((resolve, reject) =>
		{	
			Logger.log({
				console: 'true',
				level: 'info',
				message: `Query: ${JSON.stringify(option)}`
			});
			this.client.query(option, (err, res) => resolve(res))
			Logger.log({
				console: 'true',
				level: 'info',
				message: `Query: ${JSON.stringify(option)} Done.`
			});
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
		if (existed == false) {
			const result = await this.Query({
				text: `SELECT * FROM ${this.table} WHERE nickname = $1 AND title = $2 AND href = $3 AND img = $4;`,
				values: [ nickname, data.title, data.href, data.img ],
			})
			existed = result.rowCount && result.rowCount > 0;
		}
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
			await this.Query({
				text: `INSERT INTO ${this.table} (title, href, img, isNoticed, type, nickname) VALUES ($1, $2, $3, $4, $5, $6);`,
				values: [ data.title, data.href, data.img, false, containerType, nickname ],
			})
			Logger.log({
				level: 'info',
				message: `Add New Entry, title = <${data.title}>`
			});
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
		return this.ConvertToOldFormat(this.unNoticedCache)
	}
}

module.exports = SubscriptionsDB;
