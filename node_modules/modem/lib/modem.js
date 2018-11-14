var pdu = require('pdu');
var node_pdu = require('node-pdu')
var SerialPort = require('serialport');
var EventEmitter = require('events').EventEmitter;

var createModem = function() {
    var modem = new EventEmitter();

    modem.queue = []; //Holds queue of commands to be executed.
    modem.isLocked = false; //Device status
    modem.partials = {}; //List of stored partial messages
    modem.isOpened = false;
    modem.errorCounter = 0;
    modem.job_id = 1;
    modem.buffer = null;
    modem.ussd_pdu = true; //Should USSD queries be done in PDU mode?

    //For each job, there will be a timeout stored here. We cant store timeout in item's themselves because timeout's are
    //circular objects and we want to JSON them to send them over sock.io which would be problematic.
    var timeouts = {};

    //Adds a command to execution queue.
    //Command is the AT command, c is callback. If prior is true, the command will be added to the beginning of the queue (It has priority).
    modem.execute = function(command, c, prior, timeout) {

        var item = new EventEmitter();
        item.command = command;
        item.callback = c;
        item.add_time = new Date();
        item.id = ++this.job_id;
        item.timeout = timeout;
        if(item.timeout == undefined || item.timeout == false) //Default timeout it 10 seconds. Send false to disable timeouts.
            item.timeout = 50000;

        if(prior)
            this.queue.unshift(item);
        else
            this.queue.push(item);

        this.emit('job', item);
        process.nextTick(this.executeNext.bind(this));
        return item;
    }

    //Executes the first item in the queue.
    modem.executeNext = function() {

        //Someone else is running. Wait.
        if(this.isLocked)
            return ;

        var item = this.queue[0];

        if(!item) {
            this.emit('idle');
            return ; //Queue is empty.
        }

        //Lock the device and null the data buffer for this command.
        this.data = '';
        this.isLocked = true;

        item.execute_time = new Date();

        modem.emit('command', item['command']);

        timeouts[item.id] = setTimeout(function() {
            item.emit('timeout');

            if(item.callback)  
                item.callback('timeout', 'timeout')

				this.port.resume();
            this.errorCounter = this.errorCounter + 3;
            this.release();
            this.executeNext();
        }.bind(this), item.timeout);
        
        if(!this.isOpened) {
            this.close('Port is not open');
            return ;
        }
        
        modem.port.write(item['command']+"\r");
    }

    modem.open = function(device, callback) {
        
        try
        {
            modem.port = new SerialPort(device, {
                echo: false,
                baudRate: 115200
            });
            
            modem.port.pipe(new SerialPort.parsers.Readline({delimeter: '\r\n'}));

            modem.port.on('error', function(error) 
            {
                modem.emit('error', error);
            });

            modem.port.on('open', function() 
            {                         
               //Flag modem open
               modem.isOpened = true;
               modem.reset_requested = false;
               modem.errorCounter = 0;

               //Bind data received
					modem.port.on('data', function (data)
					{
						//Process data received from modem
						modem.dataReceived(data);

						//Ready to receive new data
						modem.port.resume();

					}.bind(modem));
				
               //Invoke callback
               if(callback)
                  callback();
            });

            modem.port.on('close', function() 
            {
                modem.isOpened = false;
                modem.emit('close');
            });

            this.errorCounter = 0;
        } 
        catch(error)
        {
          //Failed to open serial port, log error
          modem.emit('error', error)
        }
    }

    modem.close = function(reason) 
    {
        if(this.port)
        {
            this.port.removeAllListeners();
            if(this.port.isOpen)
                this.port.close();
        }

        this.port = null;
        this.isOpened = false;
        this.emit('close', reason);
        this.removeAllListeners();
    }

    modem.dataReceived = function(buffer) {
        //We dont seriously expect such little amount of data. Ignore it.
        if(buffer.length < 2)
            return ;
        
        //If there is data available on buffer
        if(modem.buffer)
        {
            //Concatenate with current buffer
            buffer = Buffer.concat([modem.buffer, buffer]);

            //Clear modem buffer
            modem.buffer = null;
        }

        //Parse buffer data
        var datas = buffer.toString().trim().split('\r');

        //If data is too short
        if(datas.length == 1 && datas[0].length < 4 && datas[0].startsWith('+'))
        {
            //Save data on buffer
            modem.buffer = buffer;

            //End method and wait for next data received event
            return;
        } 
        else if (datas.length == 1 && datas[0].length == 0)
        {
            //Check for empty data field (irrelevant, end method and wait for next event)
            return;
        }

        //Emit received data for those who care.
        this.emit('data', datas);

        //For each line in the array buffer
        datas.forEach(function(data, index) {

            // When we write to modem, it gets echoed.
            // Filter out queue we just executed.
            if(this.queue[0] && this.queue[0]['command'].trim().slice(0, data.length) === data) {
                this.queue[0]['command'] = this.queue[0]['command'].slice(data.length);
                return ;
            }

            if(data.trim().slice(0,5).trim() === '+CMTI') {
                this.smsReceived(data);
                return ;
            }

            //DLINK - delivery report command
            if(data.trim().slice(0,5).trim() === '+CDS:') {
                this.deliveryReceived(data + datas[index + 1]);
                return ;
            }

            //HUAWEI - delivery report
            if(data.trim().slice(0,5).trim() === '+CDSI') {
                this.deliveryReceived(data);
                return ;
            }

            if(data.trim().slice(0,5).trim() === '+CLIP') {
                this.ring(data);
                return ;
            }

            if(data.trim().slice(0,10).trim() === '^SMMEMFULL') {
                modem.emit('memory full', modem.parseResponse(data)[0]);
                return ;
            }

            if(data.trim().slice(0,8).trim() === '^SYSINFO') 
            {
               //Split response
               var data = modem.parseResponse(data);

               //Modem info response dictionary
               var modem_info = {};

               //Get system service status
               switch(data[0])
               {
                  case "0":
                     modem_info.service = "NO SERVICE";
                     modem_info.registered = false;
                     break;
                  case "1":
                     modem_info.service = "RESTRICTED SERVICES";
                     modem_info.registered = false;
                     break;
                  case "2":
                     modem_info.service = "REGISTERED";
                     modem_info.registered = true;
                     break;
               }

               //Get system service domain                
               switch(data[1])
               {
                  case "0":
                     modem_info.domain = "NO SERVICE";
                     break;
                  case "1":
                     modem_info.domain = "CS ONLY";
                     break;
                  case "2":
                     modem_info.domain = "PS ONLY";
                     break;
                  case "3":
                     modem_info.domain = "CS+PS SERVICES";
                     break;
                  case "4":
                     modem_info.domain = "NOT REGISTERED, SEARCHING...";
                     break;
               }
               
               //Get modem roaming status
               modem_info.roaming = data[2] == "0" ? "NOT ROAMING" : "ROAMING";

               //Get system mode         
               switch(data[3])
               {
                  case "0":
                     modem_info.mode = "NO SERVICE";
                     break;
                  case "3":
                     modem_info.mode = "GSM/GPRS MODE";
                     break;
                  case "5":
                     modem_info.mode = "WCDMA MODE";
                     break;
                  case "7":
                     modem_info.mode = "GSM/WCDMA MODE";
                     break;
               }

               //Get state of the SIM card   
               switch(data[4])
               {
                  case "0":
                     modem_info.sim_card = "INVALID SIM CARD";
                     break;
                  case "1":
                     modem_info.sim_card = "VALID SIM CARD";
                     break;
                  case "2":
                     modem_info.sim_card = "INVALID SIM CARD IN CS";
                     break;
                  case "3":
                     modem_info.sim_card = "INVALID SIM CARD IN PS";
                     break;
                  case "4":
                     modem_info.sim_card = "INVALID SIM CARD IN CS AND PS";
                     break;
                  case "240":
                     modem_info.sim_card = "ROM SIM VERSION";
                     break;
                  case "255":
                     modem_info.sim_card = "NO SIM CARD FOUND";
                     break;
               }
               
               //Get modem roaming status
               modem_info.sim_lock = data[5] == "0" ? "SIM NOT LOCKED" : "SIM CARD LOCKED";

               //Get state of the SIM card   
               switch(data[6])
               {
                  case "0":
                     modem_info.network = "NO SERVICE";
                     break;
                  case "1":
                     modem_info.network = "GSM MODE";
                     break;
                  case "2":
                     modem_info.network = "GPRS MODE";
                     break;
                  case "3":
                     modem_info.network = "EDGE MODE";
                     break;
                  case "4":
                     modem_info.network = "WCDMA MODE";
                     break;
                  case "5":
                     modem_info.network = "HSDPA MODE";
                     break;
                  case "6":
                     modem_info.network = "HSUPA MODE";
                     break;
                  case "7":
                     modem_info.network = "HSDPA/HSUPA MODE";
                     break;
               }

               //Update current modem info
               this.info = modem_info;

               this.emit('modem info', modem_info);
               return ;
            }


            //We are expecting results to a command. Modem, at the same time, is notifying us (of something).
            //Filter out modem's notification. Its not our response.
            if(this.queue[0] && data.trim().substr(0,1) === '^')
                return ;

            if(data.trim() === 'OK' || data.trim().match(/error/i) || data.trim() === '>') { //Command finished running.
                if(this.queue[0])
                    var c = this.queue[0]['callback']
                else
                    var c = null;

                var allData = this.data;
                var delimeter = data.trim();

                //If modem return error
                if(data.trim().match(/error/i))
                {
                    //Error executing command
                    this.errorCounter++;
                }

                /*
                Ordering of the following lines is important.
                First, we should release the modem. That will remove the current running item from queue.
                Then, we should call the callback. It might add another item with priority which will be added at the top of the queue.
                Then executeNext will execute the next command.
                */
                if(this.queue[0])
                {
                    this.queue[0]['end_time'] = new Date();
                    this.queue[0].emit('end', allData, data.trim());
						  clearTimeout(timeouts[this.queue[0].id]);
						  delete timeouts[this.queue[0].id];
                }

                this.release();

                if(c)
                    c(allData, data.trim()); //Calling the callback and letting her know about data.

                this.executeNext();

            } else
					 this.data += data; //Rest of data for a command. (Long answers will happen on multiple dataReceived events)
					 
        }.bind(this));
    }

    modem.release = function() {
        this.data = ''; //Empty the result buffer.
        this.isLocked = false; //release the modem for next command.
        this.queue.shift(); //Remove current item from queue.
    }

    modem.smsReceived = function(cmti) {
        var message_info = this.parseResponse(cmti);
        var memory = message_info[0];
        this.execute('AT+CPMS="'+memory+'"', function(memory_usage) {
            var memory_usage = modem.parseResponse(memory_usage);
            var used  = parseInt(memory_usage[0]);
            var total = parseInt(memory_usage[1]);

            if(used === total)
                modem.emit('memory full', memory);
        });
        this.execute('AT+CMGR='+message_info[1].trim(), function(cmgr) {
            var lines = cmgr.trim().split("\n");
            var message = this.processReceivedPdu(lines[1], message_info[1]);
            if(message)
                this.emit('sms received', message);
        }.bind(this));
    }

    modem.deliveryReceived = function(delivery) 
    {
        //If modem responds with CDSI (Huawei)
        if(delivery.indexOf("CDSI:") >= 0)
        {
            //Parse response from modem
            var response = this.parseResponse(delivery);

            //Perform steps to open delivery report
            this.execute('AT+CPMS="'+response[0]+'"');
            this.execute('AT+CMGR='+response[1].trim(), function(cmgr) {
                var lines = cmgr.trim().split("\n");
                var deliveryResponse = pdu.parseStatusReport(lines[1]);
                deliveryResponse.indexes = [response[1]];
                this.emit('delivery', deliveryResponse, response[1]);
            }.bind(this));
        }
        else
        {
            //D-link responds with CDS: and PDU in the same response
            var lines = delivery.trim().split("\n");
            var deliveryResponse = pdu.parseStatusReport(lines[1]);
            deliveryResponse.indexes = [];
            this.emit('delivery', deliveryResponse);
        }
    }

    modem.ring = function(data) {
        var clip = this.parseResponse(data);
        modem.emit('ring', clip[0]);
    }

    modem.parseResponse = function(response) {
        var plain = response.slice(response.indexOf(':')+1).trim();
        var parts = plain.split(/,(?=(?:[^"]|"[^"]*")*$)/);
        for(i in parts)
            parts[i] = parts[i].replace(/\"/g, '');

        return parts;
    }

    modem.processReceivedPdu = function(pduString, index) {
        try {
            var message = pdu.parse(pduString);
        } catch(error) {
            return ;
        }
        message['indexes'] = [index];

        if(typeof(message['udh']) === 'undefined') //Messages has no data-header and therefore, is not contatenated.
            return message;

        if(message['udh']['iei'] !== '00' && message['udh']['iei'] !== '08') //Message has some data-header, but its not a contatenated message;
            return message;

        var messagesId = message.sender+'_'+message.udh.reference_number;
        if(typeof(this.partials[messagesId]) === 'undefined')
            this.partials[messagesId] = [];

        this.partials[messagesId].push(message);
        if(this.partials[messagesId].length < message.udh.parts)
            return ;

        var text = '';
        var indexes = [];

        for(var i = 0; i<message.udh.parts;i++)
            for(var j = 0; j<message.udh.parts;j++)
                if(this.partials[messagesId][j].udh.current_part === i+1) {
                    text += this.partials[messagesId][j].text;
                    indexes.push(this.partials[messagesId][j].indexes[0]);
                    continue ;
                }
        message['text'] = text; //Update text.
        message['indexes'] = indexes; //Update idex list.

        delete this.partials[messagesId]; //Remove from partials list.

        return message;
    }

    modem.getMessages = function(callback) {
        this.execute('AT+CMGL=4', function(data) {
            var messages = [];
            var lines = data.split("+"); //TODO: \n AND \r\n
            var i = 0;
            lines.forEach(function(line) {
					 var parts = line.split('\n');
					 
					 if(parts[1] && parts[1].length > 15)
					 {
						 var message = node_pdu.parse(parts[1]);
					 
						if(message.getData())
						{
							this.emit("sms received", {
								indexes: [parts[0].split(',')[0].substring(6)],
								sender: message.getAddress().getPhone(),
								time: new Date(message.getScts().getTime() * 1000),
								text: message.getData().getText()
							}); 
						}
						else if(message.getReference())
						{
							this.emit("delivery", {
								indexes: [parts[0].split(',')[0].substring(6)],
								sender: message.getAddress().getPhone(),
								time: new Date(message.getDateTime().getTime() * 1000),
								reference: message.getReference(),
								status: message.getStatus()
							}); 
						}
					}
            }.bind(this));
                
        }.bind(this));
    }

    modem.sms = function(message, callback) {
        var i = 0;
        var ids = [];

        // Initialize an pdu submit
        var submit = node_pdu.Submit();
    
        // set validity period 5 minutes
        submit.setVp(300);

        //TEST PURPOSE
        //var dataScheme = new (node_pdu.getModule('PDU/DCS'))();
        //dataScheme.setDiscardMessage();
        //submit.setDcs(dataScheme);
        
        // set number of recipent (required)
        submit.setAddress(message.receiver);
    
        // set text of message (required)
        submit.setData(message.text);
    
        // set status report request (optional, default is off)
        submit.getType().setSrr(1);
    
        // get all parts of message
        var pdus = submit.getParts();

        //sendPDU executes 'AT+CMGS=X' command. The modem will give a '>' in response.
        //Then, appendPdu should append the PDU+^Z 'immediately'. Thats why the appendPdu executes the pdu using priority argument of modem.execute.
        var sendPdu = function(pdu) { // Execute 'AT+CMGS=X', which means modem should get ready to read a PDU of X bytes.
            this.execute("AT+CMGS="+((pdu.toString().length/2)-1), appendPdu);
            }.bind(this);

        var appendPdu = function(response, escape_char) { //Response to a AT+CMGS=X is '>'. Which means we should enter PDU. If aything else has been returned, there's an error.
            if(escape_char !== '>')
                return (callback == null ? null : callback(response, escape_char)); //An error has happened.

            var job = this.execute(pdus[i].toString()+String.fromCharCode(26), function(response, escape_char) {
                if(escape_char.match(/error/i) || escape_char.match(/timeout/i) )
                    //Callback
                    return callback("ERROR", escape_char);

                var response = this.parseResponse(response);

                ids.push(response[0]);
                i++;

                if(typeof(pdus[i]) === 'undefined') {
                    if(callback)
                        callback("SENT", ids[0]); //We've pushed all PDU's and gathered their ID's. calling the callback.
                        modem.emit('sms sent', message, ids);
                } else {
                    sendPdu(pdus[i]); //There's at least one more PDU to send.
                }
            }.bind(this), true, false);

        }.bind(this);

        sendPdu(pdus[i]);
    }

    modem.on('newListener', function(listener) {
        if(listener == 'ring')
            this.execute('AT+CLIP=1');
    });

    modem.deleteMessage = function(sms) 
    {
        //For each index in SMS (some messages are splitted)
        sms.indexes.forEach(index => { 

            //Execute delete command
            modem.execute('AT+CMGD=' + index.trim());
        });
    }

    return modem;
}

module.exports = createModem;
