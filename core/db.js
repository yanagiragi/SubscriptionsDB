const fs = require('fs');
const Logger = require('./Logger');

class SubscriptionsDB {
	constructor (filepath) {
		this.dataPath = filepath;
		this.data = JSON.parse(fs.readFileSync(this.dataPath));
		this.dirty = false;
		this.hashTable = this.CreateHashTable();
		this.saveInterval = setInterval(() => {
			this.SaveDB();
		}, 1000 * 5);
	}

	CreateHashId (typeId, nickname, entry) {
		return `${this.data.types[typeId]}_${nickname}_${entry.title}_${entry.href}_${entry.img}`;
	}

	CreateHashTable () {
		const hash = [];
		this.data.container.map((e, index) => {
			e.list.map((e2, index2) => {
				let hashId = this.CreateHashId(e.typeId, e.nickname, e2);
				hash.push(hashId);
			});
		});
		Logger.log({
			level: 'info',
			message: `Mapped ${hash.length} Hashes.`
		})
		return hash;
	}

	SaveDB () {
		if (this.dirty) {
			try {
				fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 4));
				Logger.log({
					level: 'info',
					message: 'Saving File Done, Restore Dirty to Clean'
				});
				this.dirty = false; // Restore dirty flag
			} catch (err) {
				Logger.log({
					level: 'error',
					message: `Error when writing file, error=<${err.message}>`
				});
			}
		}
	}

	/*
    *	Params:
    *		containerId: container.container 中的 Id
    *	Return
    *		index: container.container 中的 Index
    *
    *	目的: 因為 Id 並非照順序排且可能會用跳的
    *
    *	Examples:
    *
    *	60
    *		typeId	22
    *		nickname	"鬼月あるちゅ SearchList"
    *		list	[…]
    *		id	60
    *	61
    *		typeId	20
    *		nickname	"アルノサージュ SearchList"
    *		list	[…]
    *		id	62
    *
    */
	MapContainerIdToIndex (containerId) {
		let index = -1;
		for (let i = 0, isFound = false; i < this.data.container.length; ++i) {
			// use '==' instead of '===' to handle old id type is string, however new id type is integer
			// eslint-disable-next-line
			if (this.data.container[i].id == containerId) {
				if (!isFound) {
					isFound = true;
					index = i;
				} else {
					Logger.log({
						level: 'error',
						message: `Duplicated Id Found: <${containerId || null}>`
					});
					index = -1;
					break;
				}
			}
		}

		return index;
	}

	MapListIdToIndex (containerId, listId) {
		let index = -1;
		for (let i = 0, isFound = false; i < this.data.container[containerId].list.length; ++i) {
			// use '==' instead of '===' to handle old id type is string, however new id type is integer
			// eslint-disable-next-line
			if (this.data.container[containerId].list[i].id == listId) {
				if (!isFound) {
					isFound = true;
					index = i;
				} else {
					Logger.log({
						level: 'error',
						message: `Duplicated Id Found in ${containerId || null}: <${listId || null}>`
					});
					index = -1;
					break;
				}
			}
		}

		return index;
	}

	/*
    *	Params:
    *		containerId: container.container 中的 Index
    *		listId: container.container[index].list 的 Index
    *
    */
	NoticeEntry (containerId, listId) {
		const realContainerId = this.MapContainerIdToIndex(containerId);
		const realListId = this.MapListIdToIndex(realContainerId, listId);
		const isEntryExists = realContainerId !== -1 && this.data.container[realContainerId] && this.data.container[realContainerId].list[realListId];
		if (isEntryExists) {
			this.data.container[realContainerId].list[realListId].isNoticed = true;
			this.dirty = true;
			Logger.log({
				console: 'true',
				level: 'info',
				message: `Read ContainerId<${realContainerId}> & ListId<${realListId}>, title = ${this.data.container[realContainerId].list[realListId].title}`
			});
		} else {
			Logger.log({
				level: 'error',
				message: `Error with ContainerId<${containerId}> & ListId<${listId}>`
			});
		}
	}

	NoticeEntryAll (containerId) {
		const realContainerId = this.MapContainerIdToIndex(containerId);
		const isContainerExists = realContainerId !== -1 && this.data.container[realContainerId];
		if (isContainerExists) {
			for (let i = 0; i < this.data.container[realContainerId].list.length; ++i) {
				const current = this.data.container[realContainerId].list[i];
				if (current.isNoticed === false) {
					current.isNoticed = true;
					Logger.log({
						console: 'true',
						level: 'info',
						message: `Read ContainerId<${realContainerId}> & ListId<${i}>, title = ${this.data.container[realContainerId].list[i].title}`
					});
				}
			}
			this.dirty = true;
		} else {
			Logger.log({
				level: 'error',
				message: `Error with ContainerId<${containerId}>`
			});
		}
	}

	/*
    *	Params:
    *		containerType(string): 哪種類型的plugin的資料
    *		nickname(string): 暱稱
    *
    *	E.g.:
    *
    *		containerType: Baidu
    *		nickname: MMD Teiba
    *		代表它為 百度的 MMD 貼吧
    *
    *	Return:
    *
    *		它在 container.container 中的 Index (int)
    *
    */
	GetContainerId (containerType, nickname) {
		const typeId = this.data.types.indexOf(containerType);
		var idx = 0;

		for (idx = 0; idx < this.data.container.length; ++idx) {
			// eslint-disable-next-line
			if (this.data.container[idx].nickname === nickname && this.data.container[idx].typeId == typeId) {
				break;
			}
		}

		return idx >= this.data.container.length ? -1 : idx;
	}

	/*
    *	Params:
    *		containerId: container.container 中的 Index
    *		data: entry 的資料
    *
    *	Return:
    *
    *		是否存在 (bool)
    *
    */
	CheckExisted (containerId, data) {
		let typeId = this.data.container[containerId].typeId;
		let nickname = this.data.container[containerId].nickname;
		let hashId = this.CreateHashId(typeId, nickname, data);
		return this.hashTable.indexOf(hashId) !== -1;
	}

	CheckContainerId (containerId, containerType, nickname) {
		const isContainerIdNotExists = containerId === -1 || this.data.types[this.data.container[containerId].typeId] !== containerType;
		if (isContainerIdNotExists) {
			// type does not exists, create new type
			Logger.log({
				level: 'info',
				message: `mapping ${containerType} ${nickname} to ${containerId} Failed. Create new this.data.container`
			});

			let matchedTypeId = 0;
			for (matchedTypeId = 0; matchedTypeId < this.data.types.length; ++matchedTypeId) {
				if (this.data.types[matchedTypeId] === containerType) {
					break;
				}
			}

			if (matchedTypeId >= this.data.types.length) {
				this.data.types.push(containerType);
			}

			let newId = 0;
			if (this.data.container.length > 0) {
				newId = parseInt(this.data.container[this.data.container.length - 1].id) + 1;
			}

			this.data.container.push({
				'typeId': matchedTypeId,
				'nickname': nickname,
				'list': [],
				'id': newId
			});

			return this.GetContainerId(containerType, nickname);
		}

		return containerId;
	}

	AddEntry (args) {
		const { containerType = -1, nickname = '', data = {} } = args;
		if (containerType === -1 || nickname === '' || data === {}) {
			Logger.log({
				level: 'error',
				message: `Invalid Entry, entry = ${JSON.stringify(args)}`
			});
			return 'Invalid Entry';
		}
		const containerId = this.CheckContainerId(this.GetContainerId(containerType, nickname), containerType, nickname);
		const existed = this.CheckExisted(containerId, data);
		const isValid = data && data.title && data.href && data.img;

		if (isValid && !existed) {
			this.dirty = true;

			/*	取得要新增的 Entry 的 Id 應該是多少
            *
            * 	由於 此 Id 不一定會是 目前 list 的長度，所以用比較麻煩的方法取得
            *
            *	(即使手動刪出中間幾個 entry，id 還是會繼續 increment 下去，不會蓋到之前的資料)
            */
			const lastDataInContainer = this.data.container[containerId].list[this.data.container[containerId].list.length - 1];

			// 如果剛剛才建立這類型，設定data.id = 0
			data.id = (lastDataInContainer) ? parseInt(lastDataInContainer.id) + 1 : 0;

			this.data.container[containerId].list.push(data);

			let typeId = this.data.container[containerId].typeId;
			let nickname = this.data.container[containerId].nickname;
			let hashId = this.CreateHashId(typeId, nickname, data);
			this.hashTable.push(hashId);

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

	GetContainerTypes () {
		return Object.assign({}, this.data.types);
	}

	GetContainer () {
		return Object.assign({}, this.data.container);
	}

	GetData() {
		return Object.assign({}, this.data);
	}
}

module.exports = SubscriptionsDB;
