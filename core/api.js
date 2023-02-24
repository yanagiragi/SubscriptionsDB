const fetch = require('node-fetch');

class SubscriptionsDbApi {
    constructor(ip) {
        this.ip = ip;
    }

    async AddEntry(args) {
        const { containerType = '', nickname = '', data = {} } = args;
        if (containerType === '' || nickname === '' || data === {}) {
            throw new Error(`Invalid AddEntry: ${JSON.stringify(args)}`);
        }
        const response = await fetch(`${this.ip}/addEntry`, {
            method: 'post',
            body: JSON.stringify({ containerType, nickname, data }),
            headers: { 'Content-Type': 'application/json' }
        });
        return response.text();
    }

    async NoticeEntry(args) {
        const { id = -1 } = args;
        if (id === -1) {
            throw new Error(`Invalid NoticeEntry: ${JSON.stringify(args)}`);
        }
        const response = await fetch(`${this.ip}/notice/${id}`);
        return response.text();
    }

    async NoticeEntryAll(args) {
        const { listIds = [] } = args;
        let responses = []
        for (const listId of listIds) {
            responses.push(await this.NoticeEntry({ id: listId }))
        }
        return responses.join(',')
    }

    async GetContainers() {
        const response = await fetch(`${this.ip}/containerAll`);
        return response.text();
    }

    async GetContainersWithFilter(type, nickname) {
        const response = await fetch(`${this.ip}/container/${encodeURI(type)}/${encodeURI(nickname)}`);
        return response.text();
    }

    async GetUnNoticedContainers(args) {
        const response = await fetch(`${this.ip}/container`);
        return response.text();
    }
}

module.exports = SubscriptionsDbApi;

// tests
if (require.main === module) {

    const defaultIp = 'http://127.0.0.1:3000';

    const test = async function () {
        const entry = {
            type: 'Baidu',
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
            type: 'Baidu',
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
            type: 'Baidu',
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
