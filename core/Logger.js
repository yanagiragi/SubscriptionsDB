const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const { combine, timestamp, label, printf } = format

const rotatedTransport = new (transports.DailyRotateFile)({
    filename: 'subscriptionsDB-%DATE%.log',
    level: 'debug',
    datePattern: 'YYYY-MM',
    zippedArchive: true,
    maxSize: '1g',
    maxFiles: '14d'
});

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
        //new transports.File({ filename: 'db.log', level: 'debug'}),
        rotatedTransport
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
