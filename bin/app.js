const express = require('express');
const compression = require('compression');
const createError = require('http-errors');
const bodyParser = require('body-parser');
const Logger = require('../core/Logger');
const morgan = require('morgan')('combined', { 'stream': Logger.stream });

// Route rules
const indexRouter = require('./routes');
const app = express();

const ipWhitelist = [
	'::ffff:0.0.0.0' // modified your white list
]

app.use(compression())
app.use(morgan);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use('/', function(req, res, next) {
	const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
	if (ipWhitelist.includes(ip)) {
		indexRouter(req, res, next)
	}
	else {
		next(createError(404))
	}
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
	next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
	// set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = req.app.get('env') === 'development' ? err : {};

	// render the error page
	res.status(err.status || 500);
	res.send('error');
});

app.listen(process.env.PORT || 7070);

module.exports = app;
