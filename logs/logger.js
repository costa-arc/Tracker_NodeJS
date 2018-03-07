//Import log manager
var winston = require('winston');

//Import path manager
var path = require('path');

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
   handleExceptions: true,
   stderrLevels: ["warn", "error"]
}));

//Do not exit on error
winston.exitOnError = false;

//Export winston logger
module.exports = winston;