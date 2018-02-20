//Import GSM modem package
var modem_module = require('modem')

//Import date time parser
const moment = require('moment');

//Import event emiter class
const EventEmitter = require('events');

//Import logger
const logger = require('../logs/logger');

//Define methods and properties
class SMS_Parser extends EventEmitter
{
  constructor(server_name, com_port)
  {
    //Call parent constructor
    super();

    //Initialize SMS array
    this._sms_sent = {};

    //Save server name
    this._server_name = server_name;

    //Save com port
    this._com_port = com_port;

    //Phone number
    this._phone_number = 'Not available';

    //Initialize modem
    this._modem = modem_module.initialize();

    //Initialize modem configuration
    this.configureModem(this._modem);
  }

  //Get modem used to receive data
  getModem()
  {
    //Return modem controller
    return this._modem;
  }

  //Get phone number from modem
  getPhoneNumber()
  {
    //Return value
    return this._phone_number;
  }
  
  //Set phone number after retrieved from modem
  setPhoneNumber(value)
  {
    //Set value
    this._phone_number = value;
  }

  //Get modem used to receive data
  getSentSMS(sms_reference)
  {
    //Return modem controller
    return this._sms_sent[sms_reference];
  }

   configureModem(modem, reset_modem)
   {
      //Error handling'
      modem.on('error', error =>
      {
         //Log error
         logger.error("Connection to modem failed: " + error);

         //Close connection to modem
         modem.close(error);
      });

      //On modem connection closed
      modem.on('close', reason => 
      {
         //Log warning 
         logger.debug("Modem connection closed: " + reason + " / Trying to open again in 30 seconds");

         //Wait 30 seconds before opening again
         setTimeout(() => 
         {
            //Reinitialize modem
            this._modem = modem_module.initialize();

            //Reinitialize modem configuration
            this.configureModem(this._modem, true);
            
         }, 30000);
      });

      //Open connection on modem serial port
      modem.open(this._com_port, result =>
      {
         //On command sent to modem
         modem.on('command', function(command) 
         {
            //Log command
            logger.debug("Modem <- [" + command + "] ");
         });

         //Execute modem configuration (RESET MODEM)
         modem.execute("ATZ");

         //Execute modem configuration (DISABLE ECHO)
         modem.execute("ATE0");

         //Execute modem configuration (ENABLE TX/RX)
         modem.execute("AT+CFUN=1");

         //Execute modem configuration (SET PDU MODE)
         modem.execute("AT+CMGF=0");

         //Execute modem configuration (ENABLE ERROR MESSAGES)
         modem.execute("AT+CMEE=2");

         //Execute modem configuration (ENABLE NETWORK REGISTRATION EVENT)
         modem.execute("AT+CREG=1");

         //Execute modem configuration (REQUEST DELIVERY REPORT)
         modem.execute("AT+CSMP=49,167,0,0");

         //Execute modem command (REQUEST MANUFACTURER)
         modem.execute("AT+CGMI", function(response)
         {
            //If this is a HUAWEI MODEM
            if(response.includes('huawei'))
            {
               //Execute modem configuration (REQUEST SMS NOTIFICATION - HUAWEI)
               modem.execute("AT+CNMI=2,1,0,2,0");
            }
            else
            {
               //Execute modem configuration (REQUEST SMS NOTIFICATION - DLINK)
               modem.execute("AT+CNMI=2,1,0,1,0");
            }
            });

         //Execute modem command (REQUEST PHONE NUMBER)
         modem.execute("AT+CNUM", (response) =>
         {
            //Get start index from the phone number
            var startIndex = response.indexOf('55');

            //If this is a HUAWEI MODEM
            if(startIndex > 0)
            {
               //Remove first part of response string
               response = response.substring(startIndex);

               //Get phone number
               this.setPhoneNumber(response.substring(2, response.indexOf('"')));

               //Log information
               logger.info("Modem successfully initialized: " + this.getPhoneNumber());
            }
            else
            {
               //Log error
               logger.error("Error retrieving phone number: " + response);
            }
         });

         //If requested to reset modem
         if(reset_modem)
         {
            //Log warning
            logger.warn("Modem reset requested, initializing");

            //Execute modem configuration (TURN OFF MODEM FEATURES)
            modem.execute("AT+CFUN=0,1");
            
            //Execute modem configuration (INITIALIZE MODEM AGAIN)
            modem.execute("AT+CFUN=1,1");
         }

         //On SMS received
         modem.on('sms received', (sms) =>
         {
            //Log output
            logger.debug("SMS RECEIVED", sms);

            //Call method to handle sms
            this.emit('data', 'sms_received',
            { 
               datetime: moment().format('YYYY/MM/DD_hh_mm_ss_SSS'),
               source: this.formatPhoneNumber(sms.sender), 
               content: sms 
            });
         });

         //On data received from modem
         modem.on('data', function(data) 
         {
            //Log any data ouput from modem
            logger.debug("Modem -> [" + data.join().replace(/(\r\n|\n|\r)/gm,"") + "]");
         });
         
         //On SMS delivery receipt received
         modem.on('delivery', (delivery_report) =>
         {
            //Log output
            logger.debug("DELIVERY REPORT", delivery_report);

            //Call method to handle delivery report
            this.emit('data', 'delivery_report',
            { 
               datetime: moment().format('YYYY/MM/DD_hh_mm_ss_SSS'),
               source: this.formatPhoneNumber(delivery_report.sender), 
               content: delivery_report 
            });
         });

         //On modem memmory full
         modem.on('memory full', function(sms) 
         {
            //Execute modem command (DELETE ALL MESSAGES)
            modem.execute("AT+CMGD=1,4", function(escape_char, response) 
            {
               //Log data
               logger.info("Modem memory full, erasing SMS: " + response)
            });
         });
      });
  }

  send_sms(tracker, text, callback)
  {
    //Send command to request current position
    this._modem.sms({
      receiver: tracker.get('identification'),
      text: text,
      encoding:'16bit'
    }, 
    (result, reference) =>
    {
      //if any error ocurred
      if(result == "SENT")
      {
        //Create an ID based on current datetime
        var sms_id = moment().format('YYYY_MM_DD_hh_mm_ss_SSS');
        
        //Save on sms_sent array
        this._sms_sent[reference] = { 
          text: text, 
          reference: reference,
          id: sms_id,
          tracker_id: tracker.get('identification')
        }

        //Result success
        callback(true, this._sms_sent[reference])       
      }
      else
      {
        //Result error
        callback(false, 'Error sending sms to tracker ' + tracker.get('name') + ': ' + result);
      }
    });
  }

  //Delete SMS from modem memory
  deleteMessage(sms)
  {

    //Call modem to request sms delete
    this.getModem().deleteMessage(sms);
  }

  formatPhoneNumber(number)
  {
    //Remove country digit indicator
    number = number.replace('+','');
    
    //Remove BR international code (if exists)
    if(number.startsWith('55'))
      number = number.replace('55', '');

    //Remove leading 0 (if exists)
    if(number.startsWith('0'))
      number = number.replace('0','');

    //Return formated number
    return number;
  }
}

module.exports = SMS_Parser