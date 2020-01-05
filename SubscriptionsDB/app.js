const createError = require('http-errors')
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')

const Logger = require('./core/Logger')
const morgan = require('morgan')('combined', { 'stream': Logger.stream })

const indexRouter = require('./routes/index')

const app = express()

app.use(morgan)

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use('/', indexRouter)
app.listen(process.env.PORT || 3010)

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

module.exports = app
