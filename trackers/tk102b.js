//Import logger module
const logger = require("../logs/logger");

//Import base tracker class
const Tracker = require("./tracker");

//Import date time parser
const moment = require("moment");

//Extends base tracker class
class TK102B extends Tracker
{
    constructor(id, sms_parser, google_services) 
    {
        //Call parent constructor
        super(id, sms_parser, google_services);
	 }

	//Save tcp socket while connection is open
	setConnection(socket)
	{
		//Save connection socket
		this._socket = socket;
	}

	//Return current tcp connection to tracker
   getConnection()
   {
      return this._socket;
	}
	
	sendCommand(command)
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
               connection.write(command);

               //Log data
               logger.info(this.get("name") + "@" + this.get("imei") + " (" + connection.remoteAddress + ") <- [" + command + "]");

               //Command sent, return ture
               return true;
            }
            catch(error)
            {
                  //Log error
                  logger.error("Error sending command to tracker " + this.get("name") + "@" + this.get("imei") + " - Error: " + error + " / Command: " + command);
            }
         }
         else
         { 
            //Log warning
            logger.warn(this.get("name") + "@" + this.get("imei") + " have pending commands, but the connection is no longer valid.");
         }
      }
      else
      {
         //Log warning
         logger.warn(this.get("name") + "@" + this.get("imei") + " have pending commands but hasn't connected yet.");
      }

      //Command not sent, return error
      return false;
   }

    checkConfigurations()
    {
        //Get current date time
        var currentDate = new Date();

        //Get last update on this tracker
        var lastConfiguration = this.get("lastConfiguration");

        //Check if tracker has not been configured yet or if last configuration occurred more than an our ago
        if(lastConfiguration == null || currentDate - lastConfiguration.datetime > 1000*60*60)
        {
            //Check if there is any pending configuration
            if(this.getPendingConfigs().length > 0)
            {    
                //Update tracker to indicate pending configuration
                this.getDB().doc("Tracker/" + this.getID()).update("lastConfiguration", 
                {
                    step: "PENDING",
                    description: "Preparando configurações para envio",
                    status: "Processo iniciado às " + moment().format("HH:mm - DD/MM"),
                    progress: 0,
                    pending: this.getPendingConfigs().length,
                    server: this.getServerName(),
                    datetime: currentDate
                });

                //Run method to execute configurations
                this.applyConfigurations();
            }
            else if (lastConfiguration == null)
            {
                //Update tracker to indicate pending configuration
                this.getDB().doc("Tracker/" + this.getID()).update("lastConfiguration", 
                {
							step: "SUCCESS", 
							description: "Configuração bem sucedida",
							status: "Processo finalizado às " + moment().format("HH:mm - DD/MM"),
							pending: 0,
							progress: 100,
							server: this.getServerName(),
							datetime: new Date()
					 });
					 
                logger.info("No pending configurations on tracker " + this.get("name") + ": Finishing configuration process")
            }
            else
            {
                logger.info("Configuration check finished on tracker " + this.get("name") + ": No updates required")
            }
        }
        else
        {
            //Log info
            logger.debug("Tracker " + this.get("name") + " configuration is not currently required. (Last: " + ((currentDate - lastConfiguration.datetime) / (1000 * 60)).toFixed(2) + " mins ago / Step: " + lastConfiguration.step + " / Description: " + lastConfiguration.status + ")");
        }
    }

    applyConfigurations()
    {
        //Save context
        var self = this;

        //Try to get first current pending configuration
        var configuration = this.getPendingConfigs()[0];

        //If there is any pending configuration
        if(configuration)
        {
            //Command to be sent to this tracker
            var command;

            //Check configuration name
            switch(configuration.name)
            {

					case "Begin":
						//GENERAL CONFIG: Initialize tracker
						command = "begin" + this.get("password");
						break;

					case "TimeZone":
						//GENERAL CONFIG: Set timezone to 0
						command = "time zone" + this.get("password") + " 0"
						break;

					case "StatusCheck":
						//GENERAL CONFIG: Request tracker status	
						command = "check" + this.get("password");
						break;

					case "IMEI":
						//GENERAL CONFIG: Request tracker IMEI
						command = "imei" + this.get("password");
						break;

					case "Reset":  
						//GENERAL CONFIG: Request tracker to reset
						command = "reset" + this.get("password");
						break;

					case "AccessPoint":
						//COMMUNICATION CONFIG: Set APN
						command = "apn" + this.get("password")+ " " +  configuration.value;
						break;

					case "APNUserPass":
						//COMMUNICATION CONFIG: Set APN user password
						command = "up" + this.get("password") + " " +  configuration.value;
						break;

					case "AdminIP":
						//COMMUNICATION CONFIG: Set server IP
						command = "adminip" + this.get("password") + " " + (configuration.value == null ? "187.4.165.10 5001" : configuration.value);
						break;
						
					case "GPRS":
						//COMMUNICATION CONFIG: Enable GPRS mode
						if(configuration.enabled)
						{
							//Send command to request status update
							command = "gprs" + this.get("password");
						}
						else
						{
							//No command required, config finished
							this.confirmConfiguration("GPRS", false, "ok");
						}
						break;
						
					case "LessGPRS":
						//COMMUNICATION CONFIG: Reduced GPRS mode
						command = "less gprs" + this.get("password") + (configuration.enabled ? " on" : " off" );
						break;
						
					case "SMS":
						//COMMUNICATION CONFIG: Enable SMS mode
						if(configuration.enabled)
						{
							//Send command to request status update
							command = "sms" + this.get("password");
						}
						else
						{
							//No command required, config finished
							this.confirmConfiguration("SMS", false, "ok");
						}
						break;
						
					case "Admin":
						//COMMUNICATION CONFIG: Set SMS administrator phone number
						command = (configuration.enabled ? "" : "no" ) + "admin" + this.get("password") + " " + (configuration.value == null ? "67998035423" : configuration.value);
						break;
						
					case "PeriodicUpdate":
						//OPERATION CONFIG: Set position update interval
						command = (configuration.enabled ? configuration.value + this.get("password") : "nofix" + this.get("password"));
						break;

					case "Sleep":
						//OPERATION CONFIG: Set sleep mode
						command = (configuration.enabled ? "sleep" + this.get("password") + " " + configuration.value : "sleep" + this.get("password") + " off");
						break;

					case "Schedule":
						//Send SMS to configure shock alert
						command = (configuration.enabled ? "schedule" + this.get("password") + " " + configuration.value : "noschedule" + this.get("password"));
						break;

					case "Move":
						//Move out alert
						command = (configuration.enabled ? "move" + this.get("password") + " " + configuration.value: "nomove" + this.get("password"));
						break;
						
					case "Speed":
						//Speed limit alert
						command = (configuration.enabled ? "speed" + this.get("password") + " " + configuration.value : "nospeed" + this.get("password"));
						break;

					case "Shock":
						//Send SMS to configure shock alert
						command = (configuration.enabled ? "shock" + this.get("password"): "noshock" + this.get("password"));
						break;

					default:
						//Config unknown, send default
						command = configuration.name + " " + configuration.value;
						break;
            }

            //Log data
            logger.debug("Executing tracker " + this.get("name") + " config " + configuration.name + ": " + command);

            //Send SMS to request command
            this.getParser().send_sms(this.get("identification"), command, (sent, result) =>
            {
                //SMS successfully sent
                if(sent)
                {
                    //Save SMS sent on Firestore DB
                    this.getDB()
                    .collection("Tracker/" + this.getID() + "/SMS_Sent")
                    .doc(result.id)
                    .set(
                    {
                        server: self.getServerName(),
                        from: self.getParser().getPhoneNumber(),
                        text: result.text,
                        reference: result.reference,
                        sentTime: new Date(),
                        receivedTime: null,
                        status: "ENROUTE"
                    })
                    .then(() =>
                    {
                        //Result sucess
                        logger.info("Config " + configuration.name + " [" + result.text +"] sent to tracker " + self.get("name") + ": Reference: #" + result.reference + " -> Firestore ID: " +  result.id);
                    })
                    .catch(error => 
                    {
                        //Result error
                        logger.warn("Config " + configuration.name + " [" + result.text +"] sent to tracker " + self.get("name") + ": Reference: #" + result.reference + " -> Could not save on firestore: " + error);
						  });
						  
							//Update configuration data on SMS successfully sent
							configuration.status.step = "SMS_SENT";
							configuration.status.description = "Configuração enviada às " + moment().format("HH:mm - DD/MM");
							configuration.status.command = result.text;
							configuration.status.datetime = new Date();

							//Check if there is any pending configuration
							this.updateConfigProgress(0.3, configuration.description, configuration.status.description);
                }
                else
                {
                    //Get configuration from main configuration array (required on applyConfiguration)
                    configuration = this.getConfiguration(configuration.name);

                    //Update configuration data on SMS error
                    configuration.status.step = "ERROR";
                    configuration.status.description = "Falha no envio ocorrida às " + moment().format("HH:mm - DD/MM");
                    configuration.status.datetime = new Date();

                    //Error executing configs, clear pending array
                    this.resetPendingConfigs();

                    //Call method to end configuration
                    this.applyConfigurations();

                    //Log info
                    logger.error("Tracker config " + configuration.name + " failed: " + result);
                }

                //Save data on firestore DB
                this.getDB()
                    .collection("Tracker/" + this.getID() + "/Configurations")
                    .doc(configuration.name)
                    .set(configuration);
            });
        }
        else if(this.get("lastConfiguration").step == "PENDING")
        {
            //Initialize last update result
            var lastConfiguration = 
            {
                step: "SUCCESS", 
                description: "Configuração bem sucedida",
                status: "Processo finalizado às " + moment().format("HH:mm - DD/MM"),
					 pending: 0,
					 progress: 100,
                server: this.getServerName(),
                datetime: new Date()
            }
				
				//Retrieve last configuration
				var last_config = Object.values(this.getConfigurations())[0];

				//If last configuration was status check
				if(last_config && last_config.name == "StatusCheck")
				{
					//Change configuration name
					lastConfiguration.description = "Status solicitado com sucesso";
				} 
				else if(last_config && last_config.name == "PeriodicUpdate")
				{
					//Change configuration name
					lastConfiguration.description = "Localização solicitada com sucesso";
				}

            //For each configuration available on this tracker
            for(var configName in this.getConfigurations())
            {
                //Get configuration data
                var config = this.getConfiguration(configName);

                //Check if any error ocurred
                if(config.status.step == "ERROR")
                {           
                    //Update tracker to indicate configuration finished
                    lastConfiguration.step = "ERROR";
                    lastConfiguration.status = config.status.description;
                    lastConfiguration.description = "Erro ao configurar rastreador";
                }
				}
            
            //Update tracker to indicate configuration finished
            this.getDB()
                .collection("Tracker")
                .doc(this.getID())
                .set(
                { 
                    lastConfiguration: lastConfiguration, 
                    lastUpdate: new Date()
                }, 
                { merge: true })
                .then(() => 
                {
                    //Check no errors ocurred during update
                    if(lastConfiguration.step == "SUCCESS")
                    {
                        //Log info
                        logger.info("Configurations on tracker " + self.get("name") + " finished successfully, updating status...");
                    }
                    else
                    {
                        //Log error
                        logger.error("Configurations on tracker " + self.get("name") + " failed on this server, updating status...");
                    }
                })
                .catch(error =>
                {
                    //Log error
                    logger.error("Could not update tracker " + self.get("name") + " status on Firestore DB: " + error);
                })
        }
	 }
	 
    parseData(type, data)
    {
        if(type === "sms_received")
        {
            //Get content from parser
            var sms = data.content;

            //If it is a delivery confirmation 
            if(!sms.text || sms.text.indexOf("entregue") > 0)
            {
                //Just log data (delivery report is handled it"s own method)
                logger.debug("Received SMS delivery report from " + this.get("name"));
                
                //Message not relevant, delete from memmory
                this.getParser().deleteMessage(sms);
            }
            else
            {
                //Remove null bytes from string
                var sms_text = sms.text.replace(/\0/g, "")

                //Save message on firestore DB
                this.getDB()
                    .collection("Tracker/" + this.getID() + "/SMS_Received")
                    .doc(data.datetime)
                    .set(
                    {
                        to: this.getParser().getPhoneNumber(),
                        receivedTime: sms.time,
                        text: sms_text
                    })
                    .then(function () 
                    {
                        // Message already saved on DB, delete from modem memmory
                        this.getParser().deleteMessage(sms);

                    }.bind(this));

                //Send notification to users subscribed on this topic
                this.sendNotification("Notify_Available", {
                    title: "Recebimento de SMS",
                    content: "SMS enviado pelo rastreador foi recebido",
                    expanded: "SMS enviado pelo rastreador foi recebido: \n\n" + sms.text.replace(/\0/g, ""),
                    datetime: sms.time.getTime().toString()
					 });
					 
					 //Set text lower case and trim string
					 sms_text = sms_text.toLowerCase().trim();

					 //Check if text is response from a configuration
                if(sms_text.startsWith("begin "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Begin", true, sms_text);
                }
                else if(sms_text.startsWith("time "))
                {
						//Confirm configuration enabled
						this.confirmConfiguration("TimeZone", true, sms_text);
                }
					 else if(!isNaN(sms_text))
					 {
						//Confirm configuration enabled
						this.confirmConfiguration("IMEI", true, sms_text);
					 }
                else if(sms_text.startsWith("reset "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Reset", true, sms_text);
                }
                else if(sms_text.startsWith("apn "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("AccessPoint", true, sms_text);
                }
                else if(sms_text.startsWith("user"))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("APNUserPass", true, sms_text);
                }
                else if(sms_text.startsWith("adminip "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("AdminIP", true, sms_text);
                }
                else if(sms_text.startsWith("gprs "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("GPRS", true, sms_text);
                }
                else if(sms_text.startsWith("less gprs on "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("LessGPRS", true, sms_text);
                }
                else if(sms_text.startsWith("less gprs off "))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("LessGPRS", false, sms_text);
                }
                else if(sms_text.startsWith("sms "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("SMS", true, sms_text);
                }
                else if(sms_text.startsWith("admin "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Admin", true, sms_text);
                }
                else if(sms_text.startsWith("noadmin "))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("Admin", false, sms_text);
                }
                else if(sms_text.includes("phone number is not"))
                {
						//Confirm configuration enabled
						this.confirmConfiguration("Admin", false, "ok");
                }
                else if(sms_text.startsWith("sleep off"))
                {
						//Confirm configuration disabled
						this.confirmConfiguration("Sleep", false, sms_text);
                }
                else if(sms_text.startsWith("sleep "))
                {
						//Confirm configuration enabled
						this.confirmConfiguration("Sleep", true, sms_text);
                }
                else if(sms_text.startsWith("noschework "))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("Schedule", false, sms_text);
                }
                else if(sms_text.startsWith("schework "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Schedule", true, sms_text);
                }
                else if(sms_text.startsWith("nofix"))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("PeriodicUpdate", false, sms_text);
                }
                else if(sms_text.startsWith("noshock "))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("Shock", false, sms_text);
                }
                else if(sms_text.startsWith("shock "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Shock", true, sms_text);
                }
                else if(sms_text.startsWith("nomove "))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("Move", false, sms_text);
                }
                else if(sms_text.startsWith("move "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Move", true, sms_text);
                }
                else if(sms_text.startsWith("nospeed "))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration("Speed", false, sms_text);
                }
                else if(sms_text.startsWith("speed "))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration("Speed", true, sms_text);
                }
                else if(sms_text.includes("password err"))
                {
						//Confirm configuration enabled
						this.confirmConfiguration("Begin", true, sms_text);
                }
                else if(sms_text.includes("help me! ok!"))
                {
                  //Confirm configuration enabled
                  logger.info("Successfully disabled SOS alert from tracker " + this.get("name"));
                }
                else if(sms_text.includes("low battery! ok!"))
                {
                  //Confirm configuration enabled
                  logger.info("Successfully disabled low battery alert from tracker " + this.get("name")); 
					 }
                else if(sms_text.startsWith("bat: "))
                {
						//Status check configuration successfully applied
						this.confirmConfiguration("StatusCheck", true, sms_text);
						
						//Log info
						logger.info("Successfully parsed status message from: " + this.get("name"));
                }
                else if(sms_text.startsWith("lac:"))
                {
							//Initialize request params array
							var requestParams = {
								mcc: "724",
								mnc: this.getMNC(this.get("network"))
							};

							//Get LAC from SMS text
							var index = sms_text.indexOf(" ");
							requestParams.lac = parseInt(sms_text.substring(4, index), 16);

							//Get CID from SMS text
							requestParams.cid = parseInt(sms_text.substring(index + 1, sms_text.indexOf("\n")), 16);

							//Log data
							logger.debug("Requesting geolocation from cell tower", requestParams);

							//will use requests available in order of api key provided
							this.getGeolocation().request(requestParams, (error, result) =>
							{  
								//If result is successfull
								if (result && result.latitude < 90 && result.longitude < 90) 
								{
									//Create coordinates object
									var coordinates = this.getGeoPoint(result.latitude, result.longitude);

									//Define tracker params to be updated
									var tracker_params = 
									{
										lastCoordinate: 
										{
											type: "GSM",
											location: coordinates,
											datetime: new Date()
										},
										lastUpdate: new Date()
									};

									//Define coordinates params to be inserted/updated
									var coordinate_params = 
									{
										cellID: requestParams.mcc + "_" + requestParams.mnc + "_" + requestParams.cid + "_" + requestParams.lac,
										batteryLevel: this.get("batteryLevel"),
										signalLevel: this.get("signalLevel"),
										datetime: new Date(),
										position: coordinates,
										speed: "N/D"
									}
									
									//Insert coordinates on db with default notification
									this.insert_coordinates(tracker_params, coordinate_params, sms_text);

									//Confirm location configuration (if requested by user)
									this.confirmConfiguration("PeriodicUpdate", true, "ok");
								} 
								else 
								{
									//Log error
									logger.error("Failed to geolocate data from GSM cell tower", requestParams);
								}

							});
						}
                else if(sms_text.indexOf("lat") >= 0)
                {
                    //Get latitude from SMS text
                    var index = sms_text.indexOf("lat:") + "lat:".length;
                    var latitude = sms_text.substring(index, sms_text.substring(index).indexOf(" ") + index);

                    //Get longitude from SMS text
                    index = sms_text.indexOf("long:") + "long:".length;
                    var longitude = sms_text.substring(index, sms_text.substring(index).indexOf(" ") + index);

                    //Get speed from SMS text
                    index = sms_text.indexOf("speed:") + "speed:".length;
                    var speed = sms_text.substring(index, sms_text.substring(index).indexOf(" ") + index);

                    //Get speed from SMS text
                    index = sms_text.indexOf("bat:") + "bat:".length;
						  var bat = sms_text.substring(index, sms_text.substring(index).indexOf("\n") + index);
						  
                    //Create coordinates object
                    var coordinates = this.getGeoPoint(parseFloat(latitude), parseFloat(longitude));

                    //Define tracker params to be updated
                    var tracker_params = 
                    {
                        lastCoordinate: 
                        {
                            type: "GPS",
                            location: coordinates,
                            datetime: new Date()
								},
								batteryLevel: bat,
                        lastUpdate: new Date()
                    };

                    //Define coordinates params to be inserted/updated
                    var coordinate_params = 
                    {
                        batteryLevel: bat,
                        signalLevel: this.get("signalLevel"),
                        datetime: new Date(),
                        position: coordinates,
                        speed: speed
                    }

                    //Insert coordinates on db
                    this.insert_coordinates(tracker_params, coordinate_params, sms_text);

                    //Confirm location configuration (if requested by user)
						  this.confirmConfiguration("PeriodicUpdate", true, "ok");
                }
                else
                {
                    //Log warning
                    logger.warn("Unable to parse message from TK102B model:  " + sms_text);
                }
            }
        }
        else if (type === "delivery_report")
        {
            //Initialize notification params
            var notificationParams = { datetime: Date.now().toString() }

            //Get delivery report data
            var delivery_report = data.content;

            //Try to get first pending configuration
            var configuration = this.getPendingConfigs()[0];

            //If report is indicating success
            if(delivery_report.status == "00")
            {
                //Set title and content
                notificationParams.title = "Alerta de disponibilidade";
                notificationParams.content = "Confirmou o recebimento de SMS";

                //If exists a pending configuration
                if(configuration)
                {
                    //Check if there is any pending configuration
                    this.updateConfigProgress(0.6, configuration.description, "Configuração recebida em " + moment().format("HH:mm - DD/MM"));
                }
            }
            else
            {
                //Failed to deliver SMS
                notificationParams.title = "Alerta de indisponibilidade";
                notificationParams.content = "Rastreador não disponível para receber SMS";

                //If exists a pending configuration
                if(configuration)
                {
                    //Show success message to user
                    configuration.status.step = "ERROR";
                    configuration.status.description = "Dispositivo indisponível às " + moment().format("HH:mm - DD/MM");

                    //Reset configuration array
                    this.resetPendingConfigs();

                    //Call method to end configurations
                    this.applyConfigurations();

                    //Update configuration status
                    this.getDB()
                        .collection("Tracker/" + this.getID() + "/Configurations")
                        .doc(configuration.name)
                        .update(configuration);
                }
            }

            //Try to get sms from sms_sent array
            var sms = this.getParser().getSentSMS(delivery_report.reference);

            //If sms_sent is available
            if(sms)
            {
                //Append SMS text on notification
                notificationParams.expanded = "Confirmou o recebimento do SMS: " + sms.text;

                //Update data on firestore DB
                this.getDB()
                    .collection("Tracker/" + this.getID() + "/SMS_Sent")
                    .doc(sms.id)
                    .update(
                    {
                        receivedTime: new Date(),
                        status: "DELIVERED"
                    });
            } 

            //Send notification
            this.sendNotification("Notify_Available", notificationParams);

            //Log data
				logger.info("Received delivery report from " + this.get("name"));
				
				//Notification sent, delete from modem memmory
				this.getParser().deleteMessage(delivery_report);
		  }
		  else if(type === "tcp_data" && data[1])
		  {
			  	//If tracker sent all available data
				if(data.length > 10)
				{
					//Parse speed (ex.: 181106115734)
					var speed = data[11];
					
					//Define tracker params to be updated
					var tracker_params = 
					{
						batteryLevel: this.get("batteryLevel"),
						signalLevel: this.get("signalLevel"),
						lastCoordinate: { datetime: datetime },
						lastUpdate: new Date()
					};

					//Get if GPS signal is fixed
					if(data[4] == "F")
					{
						//Parse coordinate
						var coordinates = this.getGeoPoint(this.parseCoordinate(data[7], data[8]), this.parseCoordinate(data[9], data[10]));

						//Parse datetime (ex.: 181106115734)
						var datetime = moment.utc(data[2].substring(0, 6) + data[5], "YYMMDDhhmmss").toDate();
						
						//Update tracker params
						tracker_params.lastCoordinate.type = "GPS";
						tracker_params.lastCoordinate.location = coordinates;

						//Define coordinates params to be inserted/updated
						var coordinate_params = 
						{
							datetime: datetime,
							signalLevel: "N/D",
							batteryLevel: "N/D",
							position: coordinates,
							speed: speed
						}
						
						//Insert coordinates on DB
						this.insert_coordinates(tracker_params, coordinate_params, data[1]);
					}
					else
					{
						//Initialize request params array
						var requestParams = 
						{
							mcc: "724",
							mnc: this.getMNC(this.get("network")),
							lac: parseInt(data[7], 16),
							cid: parseInt(data[9], 16)
						};

						//Log data
						logger.debug("Requesting geolocation from cell tower", requestParams);

						//will use requests available in order of api key provided
						this.getGeolocation().request(requestParams, (error, result) =>
						{  
							//If result is successfull
							if (result && result.latitude < 90 && result.longitude < 90) 
							{
								//Create coordinates object
								var coordinates = this.getGeoPoint(result.latitude, result.longitude);

								//Define tracker params to be updated
								var tracker_params = 
								{
									lastCoordinate: 
									{
										type: "GSM",
										location: coordinates,
										datetime: new Date()
									},
									lastUpdate: new Date()
								};

								//Define coordinates params to be inserted/updated
								var coordinate_params = 
								{
									cellID: requestParams.mcc + "_" + requestParams.mnc + "_" + requestParams.cid + "_" + requestParams.lac,
									batteryLevel: this.get("batteryLevel"),
									signalLevel: this.get("signalLevel"),
									datetime: new Date(),
									position: coordinates,
									speed: "N/D"
								}
								
								//Insert coordinates on db with default notification
								this.insert_coordinates(tracker_params, coordinate_params, data[1]);
							}
						});
					}

					//Confirm location configuration (if requested by user)
					this.confirmConfiguration("Location", true, "ok");
					this.confirmConfiguration("PeriodicUpdate", true, "ok");
				}
				else if(data[1] == "connection")
				{
					//Send notification to users subscribed on this topic
					this.sendNotification("Notify_Available", {
						title: "Conexão GPRS",
						content: "Rastreador conectado",
						expanded: "O rastreador se conectou ao servidor Intelitrack",
						datetime: Date.now().toString()
					});

					//Confirm connection
					this.sendCommand("LOAD");
				}
				else if(data[1] == "heartbeat")
				{
					//Heartbeat-packet 
					this.sendCommand("ON");
				}
				else
				{
					//Warning
					logger.warn("Unknown TK102B data structure")
				}
		  }
	 }
	 
    confirmConfiguration(configName, enabled, response)
    {
        //Get configuration by name
        var config = this.getConfiguration(configName);

        //Check if config currently pending to tracker
        if(config && !config.status.finished)
        {
            //Change configuration status
            config.enabled = enabled;
            config.status.finished = true;
            config.status.datetime = new Date();

            //Check if configuration successfully applied
            if(response.includes("ok"))
            {
                //Show success message to user
                config.status.step = "SUCCESS";
                config.status.description = "Configuração " + (enabled ? "ativada" : "desativada") + " às " + moment().format("HH:mm - DD/MM");

                //Configuration completed, update progress
                this.updateConfigProgress(1, config.description, config.status.description);
            }
            else if(response.includes("password err") || response.includes("pwd fail"))
            {
                //Show success message to user
                config.status.step = "ERROR";
                config.status.description = "Dispositivo recusou a senha em " + moment().format("HH:mm - DD/MM");

                //Reset configuration array
                this.resetPendingConfigs();

                //Call method to end configurations
                this.applyConfigurations();
				}
            else if (response.includes("fail"))
            {
                //Show success message to user
                config.status.step = "ERROR";
                config.status.description = "Dispositivo indicou erro às " + moment().format("HH:mm - DD/MM");

                //Reset configuration array
                this.resetPendingConfigs();

                //Call method to end configurations
                this.applyConfigurations();
            }
				else if(configName == "IMEI")
				{
					//Update tracker to save IMEI
					this.getDB().doc("Tracker/" + this.getID()).update("imei", response);

					//Show success message to user
					config.status.step = "SUCCESS";
					config.status.description = "Configuração confirmada às " + moment().format("HH:mm - DD/MM");
					config.value = response;

					//Configuration completed, update progress
					this.updateConfigProgress(1, config.description, config.status.description);
				}
				else if(configName == "StatusCheck")
				{
				
					//Get battery level from SMS text
					var index = response.indexOf("bat: ") + "bat: ".length;
					var battery_level = response.substring(index, response.substring(index).indexOf("\n") + index);

					//Get signal level from SMS text
					index = response.indexOf("gsm: ") + "gsm: ".length;
					var signal_level = (parseInt(response.substring(index, response.substring(index).indexOf("\n") + index))*10/3).toFixed(0) + "%";

					//Update value on firestore DB
					this.getDB().doc("Tracker/" + this.getID()).update({
						signalLevel: signal_level,
						batteryLevel: battery_level
					});

					//Send notification to users subscribed on this topic
					this.sendNotification("Notify_StatusCheck", {
						title: "Atualização de status",
						content: "Bateria: " + battery_level + " / Sinal GSM: " + signal_level,
						datetime: Date.now().toString()
					});

					//Show success message to user
					config.status.step = "SUCCESS";
					config.status.description = "Configuração confirmada às " + moment().format("HH:mm - DD/MM");
					config.value = response;

					//Configuration completed, update progress
					this.updateConfigProgress(1, config.description, config.status.description);
				}

            //Update configuration status on firestore DB
            this.getDB()
                .collection("Tracker/" + this.getID() + "/Configurations")
                .doc(config.name)
                .set(config)
                .then(() =>
                {
                    // Message already saved on DB, delete from modem memmory
                    logger.info("Tracker " + this.get("name") + " config " + configName + " successfully executed")

                });
        }
    }


    updateConfigProgress(config_progress, config_description, status_description)
    {
        //Try to get total pending configuration count
        var pending = this.get("lastConfiguration").pending;

        //Check if there is any pending configuration
        if(pending)
        {
            //Calculate configuration progress 
            var progress = ((pending - this.getPendingConfigs().length + config_progress) * 100 / pending).toFixed(0);
    
            //Update tracker to indicate pending configuration
            this.getDB().doc("Tracker/" + this.getID()).update(
            { 
                lastConfiguration: 
                {
                    step: "PENDING",
                    description: config_description,
                    status: status_description,
                    pending: pending,
                    progress: progress,
                    server: this.getServerName(),
                    datetime: new Date()
                },
                lastUpdate: new Date()
            })
            .then((result) => 
            {
                //If config progress is completed (called by confirmConfiguration)
                if(config_progress == 1)
                {
                    //Remove configuration from pending array
                    this.getPendingConfigs().splice(0, 1);

                    //Call method to execute next pending configuration
                    this.applyConfigurations();
                }
            })
            .catch(error =>
            {
                //Log error
                logger.error("Error updating configuration progress: " + error);
            });    
        }   
    }

    insert_coordinates(tracker_params, coordinate_params, text)
    {
        //If this is an move alert message
        if(text.includes("move"))
        {
            //Insert coordinates on DB and build move alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: "Notify_MoveOut",
                title: "Alerta de evasão",
                content: "Movimentação além do limite determinado."
            });
        }
        else if(text.includes("speed"))
        {
            //Insert coordinates on DB and build speed alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: "Notify_OverSpeed",
                title: "Alerta de velocidade",
                content: "Velocidade acima do limite determinado."
            });
        }
        else if(text.includes("shock"))
        {
            //Insert coordinates on DB and build shock alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: "Notify_Shock",
                title: "Alerta de vibração",
                content: "Vibração detectada pelo dispositivo."
            });
        }
        else if(text.includes("help me"))
        {
            //Insert coordinates on DB and build shock alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
               topic: "Tracker_SOS",
               title: "Alerta de emergência (SOS)",
               content: "Botão de SOS pressionado no dispositivo"
            });

            //Send command to disable SOS alarm
            this.disableAlert("help me");
        }
        else if(text.includes("low battery"))
        {
            //Insert coordinates on DB and build shock alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: "Notify_LowBattery",
                title: "Alerta de bateria fraca",
                content: "Nível de bateria abaixo do ideal"
            });

            //Send command to disable low battery alert
            this.disableAlert("low battery" + this.get("password") );
        }
        else
        {
            //Call super method using default notifications
            super.insert_coordinates(tracker_params, coordinate_params);
        }
    }

    disableAlert(command)
    {
      //Log debug
      logger.debug("Sending [" + command + "] to disable alert from tracker" + this.get("name"));

      //Send SMS to request command
      this.getParser().send_sms(this.get("identification"), command, (sent, result) =>
      {
         //SMS successfully sent
         if(sent)
         {
            //Save SMS sent on Firestore DB
            this.getDB()
            .collection("Tracker/" + this.getID() + "/SMS_Sent")
            .doc(result.id)
            .set(
            {
               server: this.getServerName(),
               from: this.getParser().getPhoneNumber(),
               text: result.text,
               reference: result.reference,
               sentTime: new Date(),
               receivedTime: null,
               status: "ENROUTE"
            })
            .then(() =>
            {
               //Result sucess
               logger.info("Sent [" + command + "] command to tracker " + this.get("name") + ": Reference: #" + result.reference + " -> Firestore ID: " +  result.id);
            })
            .catch(error => 
            {
               //Result warning
               logger.warn("Command [" + command + "] sent to tracker " + this.get("name") + ": Reference: #" + result.reference + " -> Could not save on firestore: " + error);
            }); 
         }
         else
         {
            //Result error
            logger.error("Could not disable alert from tracker " + this.get("name") + ", error sending SMS: " + error);
         }
      });
	 }
}

module.exports = TK102B