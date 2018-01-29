/* Usage: node ussd.js *140# */

var modem = require('../index.js').Modem();
var session = require('../index.js').Ussd_Session();

var gotResponse = function() {
  console.log('Arguments', arguments);
}

session.execute = function() {
  console.log('Executing');
  session.query(process.argv[2], gotResponse);
  session.on('close', function() {
    console.log('Closed');
  });
}

modem.open('/dev/ttyUSB0', function() {
  console.log('Opened');
  session.modem = modem;
  session.start();
});