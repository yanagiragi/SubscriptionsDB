const express = require('express')
const compression = require('compression')
const createError = require('http-errors')
const bodyParser = require('body-parser')
const Logger = require('../core/Logger')
const morgan = require('morgan')('combined', { 'stream': Logger.stream })
const fs = require('fs')
const path = require('path')

if (!fs.existsSync('setting.json')) {
    console.error('Detect setting config not exist. Abort.')
    process.exit(-1)
}

const notUseRestrictMode = process.env.restrict_mode === "false" || false
const setting = JSON.parse(fs.readFileSync(path.join(__dirname, 'setting.json')))
const ipWhitelist = setting.whitelists
const port = process.env.port || 3000

// Route rules
const { router, db } = require('./routes')
const app = express()

app.use(compression())
app.use(morgan)
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use('/', function (req, res, next) {
    // Add notUseRestrictMode for docker
    if (notUseRestrictMode) {
        indexRouter(req, res, next)
        return
    }

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
    if (ipWhitelist.includes(ip)) {
        indexRouter(req, res, next)
    }
    else {
        console.log(`Block ${ip}`)
        next(createError(404))
    }
})

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404))
})

// error handler
app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    // render the error page
    res.status(err.status || 500)
    res.send('error')
})

async function Run () {
    await db.Init()
    app.listen(port, () => Logger.log({ level: 'info', message: `App started listen on port: ${port}` }))
}

// start listen request
Run()