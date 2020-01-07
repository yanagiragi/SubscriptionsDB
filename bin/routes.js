const express = require('express');
const path = require('path')
const filepath = path.join(__dirname, '../data/container.json');
const SubscriptionsDB = require('../core/db');
const DB = new SubscriptionsDB(filepath)
const router = express.Router();

router.get('/', function (req, res, next) {
	res.send('Yello. This is SubscriptionDB entry point.');
});

// api for notification, no use fow now
router.get('/container', function (req, res, next) {
	const container = DB.GetContainer();
	res.send(JSON.stringify(container));
});

// api for notification, no use for now
router.get('/containerType', function (req, res, next) {
	const types = DB.GetContainerTypes();
	res.send(JSON.stringify(types));
});

router.get('/notice/:containerId/:entryId', function (req, res, next) {
	const containerId = req.params.containerId;
	const entryId = req.params.entryId;
	DB.NoticeEntry(containerId, entryId);
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
