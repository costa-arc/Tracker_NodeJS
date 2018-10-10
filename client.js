//Import logger module
const logger = require('./logs/logger');

//Import date time parser
const moment = require('moment');

//Extends base tracker class
class Client
{
   constructor(auth, sms_parser) 
   {

      this._auth = auth;
      //Array to store commands while tracker connection is not active
      this._sms_parser = sms_parser;
	}

	getParser()
	{
		return this._sms_parser;
	}
	
	getAuth()
	{
		return this._auth;
	}

   //Save tcp socket while connection is open
   setConnection(socket)
   {
		//If client is connecting from a different port (new connection)
		if(this._socket && this._socket.remotePort != socket.remotePort)
		{
			//Destroy previous connection
			this._socket.destroy();
		}

      //Save connection socket
      this._socket = socket;
   }

   //Return last TCP socket used by this client
   getConnection()
   {
      //Return socket
      return this._socket;
	}
	
	//Set phone number the client is currently testing
	setPhoneNumber(phoneNumber)
	{
		//Save connection socket
		this._phoneNumber = phoneNumber;
	}

	//Return phone number the client is currently testing
	getPhoneNumber()
	{
		//Save connection socket
		return this._phoneNumber;
	}

	//Close TCP connection
	disconnect()
	{
		//If connection available
		if(this._socket)
		{
			//End connection
			this._socket.destroy();
		}
	}

   //Parse data from client
   parseData(type, data)
   {
		if(type == "tcp_data")
		{
			//Request to authenticate
			if(data.length > 3)
			{
				//Auth request
				if(data[3].trim() == "CONNECT")
				{
					//Respond authentication success to client
					this.sendResponse("AUTH: OK")
				}
				else if(data[3].trim() == "TEST")
				{
					//Save phone number client wants to test
					this.setPhoneNumber(data[5].trim());

					//Send SMS to request tracker IMEI
					this.getParser().send_sms(this.getPhoneNumber(), "imei" + data[6].trim(), (sent, result) =>
					{
						//SMS successfully sent
						if(sent)
						{
							//Respond success to client
							this.sendResponse("SMS SENT");

							//Log data
							logger.debug("Sent test SMS to " + this.getPhoneNumber() + ": imei" + data[6].trim());
						}
						else
						{
							//Respond error to client
							this.sendResponse("Erro: Não foi possível enviar SMS ao rastreador.");

							//Result error
							logger.error("Could not send test SMS to " + this.getPhoneNumber() + ", error sending SMS: " + result);
						}
					});
				}
			}
		} 
		else if(type == "delivery_report")
		{
			//Respond success to client
			this.sendResponse("DELIVERY REPORT")
			
			//Message not relevant, delete from memmory
			this.getParser().deleteMessage(data.content);
		}
		else if(type == "sms_received")
		{
			//Get content from parser
			var sms = data.content;
			
			//If it is a delivery confirmation 
			if(!sms.text || sms.text.indexOf('entregue') > 0)
			{
				//Just log data (delivery report is handled it's own method)
				logger.debug('Received SMS delivery report, testing tracker ' + this.getPhoneNumber());
			}
			else
			{
				//Log data 
				logger.debug('Received SMS, testing tracker ' + this.getPhoneNumber() + ": " + sms.text);

				//Remove null bytes from string
				var sms_text = sms.text.replace(/\0/g, '');

				//Respond success to client
				this.sendResponse("IMEI: " + sms_text);
				
				//Finish connection
				this.disconnect();
			}
				
			//Message not relevant, delete from memmory
			this.getParser().deleteMessage(sms);
		}
   }

   sendResponse(command)
   {
      //Get tcp connection to tracker if available
      var connection = this.getConnection();

      //Check if connection socket exists
      if(connection != null)
      {
         //Check if connection is active
         if(connection.writable)
         {
            try
            {
               //Send command to tracker
               connection.write(command + "\n");

               //Log data
               logger.debug('Client@' + this.getAuth() + ' (' + connection.remoteAddress + ') <- [' + command + "]");

               //Command sent, return ture
               return true;
            }
            catch(error)
            {
                  //Log error
                  logger.error('Error sending command to client #' + this.getAuth() + " - Error: " + error + " / Command: " + command);
            }
         }
         else
         { 
            //Log warning
            logger.debug('Client@' + this.getAuth() + " have pending commands, but the connection is no longer valid.");
         }
      }
      else
      {
         //Log warning
         logger.debug('Client@' + this.getAuth() + " have pending commands but hasn't connected yet.");
      }

      //Command not sent, return error
      return false;
   }
}

module.exports = Client