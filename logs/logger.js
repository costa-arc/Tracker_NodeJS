//Import log manager
var winston = require('winston');

//Define application log format
const logFormat = winston.format.combine
(
    winston.format.timestamp(),
    winston.format.printf(function (info) 
    {
      const { timestamp, level, message, ...args} = info;

      return `${info.timestamp} - ${info.level}: ${info.message} ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ''}`;
    })
);

//Export winston logger
module.exports = winston.createLogger({
  transports: 
  [
    new winston.transports.Console({ 
      format: winston.format.combine(winston.format.colorize(), logFormat),
      handleExceptions: true
    }), 
    new winston.transports.File({ 
      filename: '/var/log/tracker_info.log', 
      level: 'info', 
      format: logFormat,
      maxsize: 5000000, 
      maxfiles:10 }),
    new winston.transports.File({ 
      filename: '/var/log/tracker_debug.log', 
      format: logFormat,
      maxsize: 1000000, 
      maxfiles: 20 })
  ],
  exitOnError: false,
  level: 'debug'
});