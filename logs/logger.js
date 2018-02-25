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

winston.add(new winston.transports.Console(
{ 
   level: 'debug',
   format: winston.format.combine(winston.format.colorize(), logFormat),
   handleExceptions: true
}));

winston.add(new winston.transports.File(
{ 
   filename: '/var/log/tracker_info.log', 
   level: 'info', 
   format: logFormat,
   maxsize: 5000000, 
   maxfiles: 10 
}));

winston.add(new winston.transports.File(
{ 
   filename: '/var/log/tracker_debug.log', 
   level: 'debug', 
   format: logFormat,
   maxsize: 1000000, 
   maxfiles: 20, 
   handleExceptions: true
}));

//Do not exit on error
winston.exitOnError = false;

//Export winston logger
module.exports = winston;