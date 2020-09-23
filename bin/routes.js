const fs = require('fs')
const path = require('path')
const express = require('express');
const SubscriptionsDB = require('../core/db');
const setting = JSON.parse(fs.readFileSync(path.join(__dirname, 'setting.json')))
const DB = new SubscriptionsDB(setting)
const router = express.Router();

router.get('/', function (req, res, next) {
	res.send('Yello. This is SubscriptionDB entry point.');
});

// api for notification, no use fow now
router.get('/containerAll', async function (req, res, next) {
	const container = await DB.GetContainer();
	res.send(JSON.stringify(container));
});

// api for notification, no use fow now
router.get('/container', async function (req, res, next) {
	const container = await DB.GetUnNoticedContainers();
	res.send(JSON.stringify(container));
});

// api for notification, no use for now
router.get('/containerType', async function (req, res, next) {
	const types = await DB.GetContainerTypes();
	res.send(JSON.stringify(types));
});

router.get('/notice/:containerId', function (req, res, next) {
	const containerId = req.params.containerId;
	DB.NoticeEntry(containerId);
	res.send('OK');
});

router.get('/noticeAll/:containerId', function (req, res, next) {
	const containerId = req.params.containerId;
	DB.NoticeEntryAll(containerId);
	res.send('OK');
});

router.post('/addEntry', function (req, res, next) {
	DB.AddEntry(req.body);
	res.send('OK');
});

module.exports = router;
