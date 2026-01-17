const fs = require('fs')
const path = require('path')
const express = require('express')
const SubscriptionsDB = require('../core/db')
const setting = JSON.parse(fs.readFileSync(path.join(__dirname, 'setting.json')))
const db = new SubscriptionsDB(setting)
const router = express.Router()

router.get('/', function (req, res, next) {
    res.send('Yello. This is SubscriptionDB entry point.')
})

router.get('/containerAll', async function (req, res, next) {
    const container = await db.GetContainers()
    res.send(JSON.stringify(container))
})

router.get('/container', async function (req, res, next) {
    const container = await db.GetUnNoticedContainers()
    res.send(JSON.stringify(container))
})

router.get('/container/:type/:nickname', async function (req, res, next) {
    const type = req.params.type
    const nickname = req.params.nickname
    const container = await db.GetContainersWithFilter(type, nickname)
    res.send(JSON.stringify(container))
})

router.get('/notice/:containerId', function (req, res, next) {
    const containerId = req.params.containerId
    db.NoticeEntry(containerId)
    res.send('OK')
})

router.get('/noticeAll/:containerId', function (req, res, next) {
    const containerId = req.params.containerId
    db.NoticeEntryAll(containerId)
    res.send('OK')
})

router.post('/addEntry', function (req, res, next) {
    db.AddEntry(req.body)
    res.send('OK')
})

module.exports = { router, db }
