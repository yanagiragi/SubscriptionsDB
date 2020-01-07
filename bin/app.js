const express = require('express');
const createError = require('http-errors');
const bodyParser = require('body-parser');
const Logger = require('../core/Logger');
const morgan = require('morgan')('combined', { 'stream': Logger.stream });

// Route rules
const indexRouter = require('./routes');

const app = express();

app.use(morgan);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use('/', indexRouter);

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

app.listen(process.env.PORT || 3010);

module.exports = app;
