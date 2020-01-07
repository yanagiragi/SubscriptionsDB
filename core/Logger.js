const { createLogger, format, transports } = require('winston')
const { combine, timestamp, label, printf } = format

const formatter = printf(info => {
	return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`
})

const logger = createLogger({
	format: combine(
		label({ label: 'SubscriptionsDB' }),
		timestamp(),
		formatter
	),
	transports: [
		new transports.Console({ level: 'info' }),
		new transports.File({ filename: 'db.log', level: 'debug'}),
	],
})

logger.stream = {
	write: function(message, encoding){
		logger.log({
			level: 'debug',
			message: `Express: <${message.trim()}>`
		});
	}
}

module.exports = logger
