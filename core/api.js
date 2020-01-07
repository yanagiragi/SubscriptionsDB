const fetch = require('node-fetch');

class SubscriptionsDbApi {
	constructor (ip) {
		this.ip = ip;
	}

	async AddEntry (args) {
		const { containerType = -1, nickname = '', data = {} } = args;
		if (containerType === -1 || nickname === '' || data === {}) {
			throw new Error(`Invalid AddEntry: ${JSON.stringify(args)}`);
		}
		const response = await fetch(`${this.ip}/addEntry`, {
			method: 'post',
			body: JSON.stringify({ containerType, nickname, data }),
			headers: { 'Content-Type': 'application/json' }
		});
		return response.text();
	}

	async NoticeEntry (args) {
		const { containerId = -1, listId = -1 } = args;
		if (containerId === -1 || listId === -1) {
			throw new Error(`Invalid NoticeEntry: ${JSON.stringify(args)}`);
		}
		const response = await fetch(`${this.ip}/notice/${containerId}/${listId}`);
		return response.text();
	}

	async NoticeEntryAll (args) {
		const { containerId = -1 } = args;
		if (containerId === -1) {
			throw new Error(`Invalid NoticeEntryAll: ${JSON.stringify(args)}`);
		}
		const response = await fetch(`${this.ip}/noticeAll/${containerId}`);
		return response.text();
	}
}

module.exports = SubscriptionsDbApi;

// tests
if (require.main === module) {

	const defaultIp = 'http://127.0.0.1:3000';

	const test = async function () {
		const entry = {
			containerType: 'Baidu',
			nickname: 'MMD Teiba',
			data: {
				'img': '123',
				'href': '11',
				'isNoticed': false
			}
		};
		// outputs: 'result: OK',
		// db logs 'error: Missing entry: <null, 11, 123, null>'
		const result = await new SubscriptionsDbApi(defaultIp).AddEntry(entry);
		console.log('result: ', result);
	};

	const test1 = async function () {
		const entry = {
			containerType: 'Baidu',
			nickname: 'MMD Teiba',
			data: {
				'title': 'test',
				'img': '123',
				'href': '11',
				'isNoticed': false
			}
		};
		// outputs: 'result: OK'
		// db logs 'Add New Entry, title = <test>'
		const result = await new SubscriptionsDbApi(defaultIp).AddEntry(entry);
		console.log('result: ', result);
	};

	const test2 = async function () {
		const entry = {
			containerType: 'Baidu',
			nickname: 'MMD Teiba 2',
			data: {
				'title': 'test',
				'img': '123',
				'href': '11',
				'isNoticed': false
			}
		};
		// outputs: 'result: OK',
		// db logs 'mapping Baidu MMD Teiba 2 to -1 Failed. Create new this.data.container' and 'Add New Entry, title = <test>'
		const result = await new SubscriptionsDbApi(defaultIp).AddEntry(entry);
		console.log('result: ', result);
	};

	test();
	// test1()
	// test2()
}
