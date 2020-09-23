const { Client } = require('pg')
const Logger = require('./Logger');

class SubscriptionsDB {
	constructor (setting) {
		this.client = new Client(setting.clientSetting)
		this.table = setting.table,			
		this.client.connect()
	}

	Query(option)
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

			const result = await this.Query({
				text: `SELECT * FROM ${this.table} where id = $1;`,
				values: [ id ],
			})

			Logger.log({
				console: 'true',
				level: 'info',
				message: `Read ContainerId <${id}>: ${result.rows[0].title}`
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

		const result = await this.Query({
			text: `SELECT * FROM ${this.table} WHERE nickname = $1 AND title = $2 AND href = $3 AND img = $4;`,
			values: [ nickname, data.title, data.href, data.img ],
		})
		const existed = result.rowCount && result.rowCount > 0;
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
		const nicknames = [...new Set(result.rows.map(x => x.nickname))]

		const parsed = 
		{
			types: types,
			container: []
		}
		
		for(const row of result.rows)
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
		const query = {
			text: `SELECT DISTINCT type FROM ${this.table};`,
			values: [],
		}
		const result = await this.Query(query)
		return result.rows.map(x => x.type);
	}

	async GetContainer() {
		const query = {
			text: `SELECT * FROM ${this.table};`,
			values: [],
		}
		const result = await this.Query(query)
		return this.ConvertToOldFormat(result)
	}

	async GetUnNoticedContainers() {
		const query = {
			text: `SELECT * FROM ${this.table} WHERE isNoticed = false;`,
			values: [],
		}
		const result = await this.Query(query)
		return this.ConvertToOldFormat(result)
	}
}

module.exports = SubscriptionsDB;
