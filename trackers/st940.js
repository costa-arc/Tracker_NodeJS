//Import logger module
const logger = require('../logs/logger');

//Import base tracker class
const Tracker = require('./tracker');

//Import date time parser
const moment = require('moment');

//Extends base tracker class
class ST940 extends Tracker
{
   constructor(id, tcp_parser, google_services) 
   {
      //Call parent constructor
      super(id, tcp_parser, google_services)

      //Array to store commands while tracker connection is not active
      this._pending_commands = {};
   }

   //Save tcp socket while connection is open
   setConnection(socket)
   {
      //Save connection socket
      this._socket = socket;
   }

   //Get dictionary of pending command
   getPendingCommands()
   {
      return this._pending_commands;
   }

   //Clear dictionary of pending commands
   resetPendingCommands()
   {
      this._pending_commands = {};
   }

   //Get first pending command
   getPendingCommand()
   {
      return this._pending_commands[Object.keys(this._pending_commands)[0]];
   }

   //Get count of pending commands
   getPendingCommandsCount()
   {
      return Object.keys(this._pending_commands).length;
   }

   //Add a command to pending commands array
   setPendingCommand(command_name, command_params)
   {
      this._pending_commands[command_name] = command_params;
   }

   //Return current tcp connection to tracker
   getConnection()
   {
      return this._socket;
   }

   checkConfigurations()
   {
      //Check if tracker has any configuration available
      if(this.getConfigurationsCount() > 0)
      {
         //Reset pending commands
         this.resetPendingCommands();

         //For each pending configuration
         for(let config of this.getPendingConfigs())
         {
            //Get configuration name
            switch(config.name)
            {
               case "RequestConfig":
                     //Create PRESETALL command
                     this.setPendingCommand("PRESETALL", 
                     {
                        command: "PRESETALL;" + this.getID(),
                        description: "Solicitando configurações do rastreador"
                     });
                     break;

               case "Location":
                     //Create REPORT command
                     this.setPendingCommand("FIND", 
                     {
                        command: "FIND;" + this.getID() + ";",
                        description: "Solicitando localização atual"
                     });
                     break;
                     
               case "TempOff":
                  //Create REPORT command
                  this.setPendingCommand("OFF", 
                  {
                     command: "OFF;" + this.getID() + ";" + this.getConfiguration("TempOff").value,
                     description: "Solicitando desligamento temporário"
                  });
                  break;
               case "Magnet":
               case "DeepSleep":
                     //Create SERVICE command
                     this.setPendingCommand("SVC",
                     {
                        command: "SVC;" + 
                           (this.getID()) + ";0;1;" + 
                           (this.getConfiguration("Magnet").enabled ? "1;" : "0;") + "5;10;100;5;300;100;" + 
                           (this.getConfiguration("DeepSleep").enabled ? "1" : "0"),
                        description: "Configurando: parâmetros de serviço"
                     });
                     break;

               case "TurnOff":
               case "ShockEmergency":
                     //Create FUNCTION command (do not break from switch because emergency configuration is also present in REPORT command)
                     this.setPendingCommand("FUNCTION", 
                     {
                        command: "FUNCTION;" +
                           (this.getID()) + ";" +
                           (this.getConfiguration("TurnOff").enabled ? "1;" : "0;") +
                           (this.getConfiguration("ShockEmergency").enabled ? "1" : "0"),
                        description: "Configurando: parâmetros de função"
                     });
                     break;

               case "UpdateIdle":
               case "UpdateActive":
                     //Create REPORT command
                     this.setPendingCommand("REPORT", 
                     {
                        command: "REPORT;" +
                           (this.getID()) + ";" +
                           (this.getConfiguration("UpdateIdle").enabled ? this.getConfiguration("UpdateIdle").value : "0") + ";" +
                           (this.getConfiguration("UpdateActive").enabled ? this.getConfiguration("UpdateActive").value : "0") + ";60;3;0.10",
                        description: "Configurando: parâmetros de atualização"
                     });
                     break;
            }
         }

         //Check if tracker has pending configurations
         if(this.getPendingCommandsCount() > 0)
         {
            //Check if there is any pending configuration
            if(!this.get("lastConfiguration"))
            {    
               //Build last configuration status
               var lastConfiguration = 
               {
                  progress: 0,
                  step: "PENDING",
                  description: "Aguardando conexão com rastreador",
                  status: "Processo iniciado às " + moment().format("HH:mm - DD/MM"),
                  pending: this.getPendingCommandsCount(),
                  server: this.getServerName(),
                  datetime: new Date()
               };

               //Update tracker to indicate pending configuration
               this.getDB().doc('Tracker/' + this.getID()).update(
               {
                  lastConfiguration:  lastConfiguration,
                  lastUpdate: new Date()
               })
               .then(() => 
               {
                  //Log info
                  logger.info("Tracker ST910@" + this.getID() + " started configuration process");
   
                  //Update locally last configuration value
                  this.set('lastConfiguration', lastConfiguration);

                  //Run method to execute configurations
                  this.applyConfigurations();
               });
            }
            else
            {
               //Run method to execute configurations
               this.applyConfigurations();
            }
         }
         else
         {
            //Log debug
            logger.debug("Tracker ST940@" + this.getID() + " check finished: no pending configurations.");
         }
      }
      else
      {
         //If tracker have no configuration available, request configurations
         this.requestConfiguration();
      }
   }

   updateConfigProgress(config_progress, config_description, status_description, command_name)
   {
      //Try to get total pending configuration count
      var pending = this.get('lastConfiguration').pending;

      //Check if there is any pending configuration
      if(pending)
      {
         //Calculate configuration progress 
         var progress = ((pending - this.getPendingCommandsCount() + config_progress) * 100 / pending).toFixed(0);

         //Build last configuration status
         var lastConfiguration = 
         {
            step: "PENDING",
            description: config_description,
            status: status_description,
            pending: pending,
            progress: progress,
            server: this.getServerName(),
            datetime: new Date()
         };
               
         //If config progress is completed (called by confirmConfiguration)
         if(command_name)
         {
            //Remove command from pending list
            delete this.getPendingCommands()[command_name];

            //Call method to execute next pending configuration
            this.applyConfigurations();
         }

         //If configuration still in progress
         if(progress < 100)
         {
            //Update tracker to indicate pending configuration
            this.getDB()
               .doc('Tracker/' + this.getID())
               .update(
               { 
                     lastConfiguration: lastConfiguration,
                     lastUpdate: new Date()
               })
               .then((result) => 
               {
                  //Log info
                  logger.info("Tracker ST910@" + this.getID() + " config progress (" + progress + "%): " + config_description + " -> " + status_description);

                  //Update locally last configuration value
                  this.set('lastConfiguration', lastConfiguration); 
               })
               .catch(error =>
               {
                  //Log error
                  logger.error("Error updating configuration progress: " + error);
               });   
         } 
      }
   }

   applyConfigurations()
   {
      //Try to get first pending command
      var pending = this.getPendingCommand();

      //Check if there are any pending command
      if(pending)
      {
         //Send command to tracker
         var command_sent = this.sendCommand(pending.command);

         //If command sent to tracker
         if(command_sent)
         {
            //Update progress
            this.updateConfigProgress(0.5, pending.description, "Comando enviado às " + moment().format("HH:mm - DD/MM"));
         }
      }
      else if(this.get("lastConfiguration") != null && this.get("lastConfiguration").step == "PENDING")
      {
         //Update value locally until load from DB
         this.get("lastConfiguration").step = "SUCCESS";

         //Initialize last update result
         var lastConfiguration = 
         {
            progress: 100,
            step: "SUCCESS", 
            description: "Solicitação bem sucedida",
            status: "Processo finalizado às " + moment().format("HH:mm - DD/MM"),
            server: this.getServerName(),
            datetime: new Date()
         }

         //Update tracker to indicate configuration finished
         this.getDB()
            .collection('Tracker')
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
                  logger.info('Configurations on tracker ' + this.get('name') + ' finished successfully (100% -> SUCCESS).');

                  //Update locally last configuration value
                  this.set('lastConfiguration', lastConfiguration);
               }
               else
               {
                  //Log error
                  logger.error('Configurations on tracker ' + this.get('name') + ' failed on this server, updating status...');
               }
            })
            .catch(error =>
            {
               //Log error
               logger.error('Could not update tracker ' + this.get('name') + ' status on Firestore DB: ' + error);
            })
      }
   }

   parseData(type, data)
   {
      //"ST910;Emergency;696969;500;20180201;12:26:55;-23.076226;-054.206427;000.367;000.00;1;4.1;0;1;02;1865;c57704f358;724;18;-397;1267;255;3;25\r"
      if(type == "tcp_data" && data[0] === "ST910" && (data[1] === 'Emergency' || data[1] === 'Alert' || data[1] === 'Location'))
      {
         //Parse datetime
         var datetime =  moment.utc(data[4] + "-" + data[5], "YYYYMMDD-hh;mm;ss").toDate();
			
			//Parse coordinate
         var coordinates = this.getGeoPoint(parseFloat(data[6]), parseFloat(data[7]));

         //Parse speed
         var speed = data[8];

         //Parse course
         var course = data[9];

         //Get if GPS signal is fixed or not on this message
         var coordinate_type = (data[10] == "1" ? "GPS" : "GSM");

         //Battery level
         var batteryLevel = Math.min(Math.max(((parseFloat(data[11]) - 3.45) * 140).toFixed(0), 5), 100) + '%';

         //Define tracker params to be updated
         var tracker_params = 
         {
               batteryLevel: batteryLevel,
               signalLevel: 'N/D',
               lastCoordinate: 
               {
                  type: coordinate_type,
                  location: coordinates,
                  datetime: datetime
               },
               lastUpdate: new Date()
         };

         //Get location status (GPS fixed or not)
         if(coordinate_type == "GPS")
         {
            //Define coordinates params to be inserted/updated
            var coordinate_params = 
            {
                  datetime: datetime,
                  signalLevel: 'N/D',
                  batteryLevel: batteryLevel,
                  position: coordinates,
                  speed: speed
            }

            //Insert coordinates on DB (if its alert or emergency message, also send message code)
            this.insert_coordinates(tracker_params, coordinate_params, (data[1] === 'Emergency' || data[1] === 'Alert' ? data[13] : ''));
         }
         else
         {
            //GPS not fixed, get GSM data from message
            var requestParams =
            {
               mcc: '724',
               mnc: '006',
               cid: parseInt(data[(data[1] === 'Location' ? 17 : 16)].substring(0, 4), 16).toString(),
               lac: parseInt(data[(data[1] === 'Location' ? 17 : 16)].substring(4, 8), 16).toString()
            }

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

                    //Define coordinates params to be inserted/updated
                    var coordinate_params = 
                    {
                        datetime: datetime,
                        signalLevel: 'N/D',
                        batteryLevel: batteryLevel,
                        position: coordinates,
                        speed: speed
                    }

                    //Update tracker params coordinate
                    tracker_params.lastCoordinate.location = coordinates;
                    
                    //Insert coordinates on db with default notification
                    this.insert_coordinates(tracker_params, coordinate_params, (data[1] === 'Emergency' || data[1] === 'Alert' ? data[13] : ''));
                } 
                else 
                {
                    //Log error
                    logger.error("Failed to geolocate data from GSM cell tower", requestParams);
                }
            });
         }
         
         //If emergency message type
         if(data[1] === 'Emergency')
         {
            //Send ACK command to tracker
            this.sendCommand('ACK;' + this.getID());
         }
         
         //Confirm receiving location config
         this.confirmConfiguration("Location", "1");

         //If location was sent by tracker in response to a FIND command, confirm command execution
         this.confirmCommand("FIND");
      }
      else if(data[1] === 'Alive')
      {
         //Log connection alive
         logger.info("Tracker ST940@" + this.getID() + " connected.");

         //Send notification to users subscribed on this topic
         this.sendNotification("Notify_Available", {
            title: "Rastreador conectado",
            content: "Dispositivo está conectado ao servidor.",
            datetime: Date.now().toString()
         });
      }
      else if(data[1] === 'RES')
      {
         //Tracker responded to a command previously sent
         switch(data[2])
         {
            case 'ACK':
               //Log commmand response
               logger.info("Tracker ST940@" + this.getID() + " confirmed acknowledge.");
               break;

            case 'PRESETALL':
               //Log configuration response
               logger.info("Tracker ST940@" + this.getID() + " sent current configuration.");

               //Update configuration: location when tracker active
               this.confirmConfiguration("UpdateActive", data[data.indexOf("REPORT") + 2], data[data.indexOf("REPORT") + 2]);

               //Update configuration: location when tracker idle
               this.confirmConfiguration("UpdateIdle", data[data.indexOf("REPORT") + 1], data[data.indexOf("REPORT") + 1]);

               //Update configuration: turn off option
               this.confirmConfiguration("TurnOff", data[data.indexOf("FUNCTION") + 1]);

               //Get emergency mode configuration from response
               this.confirmConfiguration("ShockEmergency", data[data.indexOf("FUNCTION") + 2]);

               //Get deep sleep configuration from response
               this.confirmConfiguration("DeepSleep", data[data.indexOf("SVC") + 10]);

               //Get magnet alert configuration from response
               this.confirmConfiguration("Magnet", data[data.indexOf("SVC") + 3]);

               //Get configuration used to retrieve tracker settings
               this.confirmConfiguration("RequestConfig", "1");
               break;

            case 'REPORT':
               //Get periodic update when active configuration from response
               this.confirmConfiguration("UpdateIdle", data[4], data[4]);

               //Get periodic update when active configuration from response
               this.confirmConfiguration("UpdateActive", data[5], data[5]);
               break;

            case 'FUNCTION':
               //Get periodic update when active configuration from response
               this.confirmConfiguration("TurnOff", data[4]);

               //Get periodic update when active configuration from response
               this.confirmConfiguration("ShockEmergency", data[5]);
               break;
               
            case 'SVC':
               //Get periodic update when active configuration from response
               this.confirmConfiguration("Magnet", data[6]);

               //Get periodic update when active configuration from response
               this.confirmConfiguration("DeepSleep", data[13]);
               break;

            case 'OFF':

               //Get periodic update when active configuration from response
               this.confirmConfiguration("TempOff", "1", data[4]);
               break;
         }
      }
      else
      {
         //Unknown data received
         logger.warn("Unknown data received from tracker " + data.join(';'));
      }

      //Call method to confirm command sent by tracker
      this.confirmCommand(data[2]);
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
               connection.write('AT^ST910;'+ command);

               //Log data
               logger.debug('ST940@' + this.getID() + ' (' + connection.remoteAddress + ') <- [AT^ST910;' + command + "]");

               //Command sent, return ture
               return true;
            }
            catch(error)
            {
                  //Log error
                  logger.error('Error sending command to tracker #' + this.getID() + " - Error: " + error + " / Command: " + command);
            }
         }
         else
         { 
            //Log warning
            logger.debug('ST940@' + this.getID() + " have pending commands, but the connection is no longer valid.");
         }
      }
      else
      {
         //Log warning
         logger.debug('ST940@' + this.getID() + " have pending commands but hasn't connected yet.");
      }

      //Command not sent, return error
      return false;
   }

   requestConfiguration()
   {
      //Insert configuration on DB if user has not set configuration yet
      this.getDB()
         .collection('Tracker/' + this.getID() + '/Configurations')
         .doc("RequestConfig")
         .set({
            name: "RequestConfig", 
            priority: 1,
            enabled: true,
            value: null,
            status: 
            {
               finished: false,
               datetime: new Date(),
               description: "Aguardando envio...",
               step: "REQUESTED"
            }
         })
         .then(() => 
         {
            //Log debug
            logger.debug("Configuration 'RequestedConfig' added to tracker ST940@" + this.getID());

            //Load new configuration from DB
            this.loadConfigFromDB();
         })
         .catch(error => 
         {
            //Log error
            logger.error("Error requesting configuration from tracker ST940@" + this.getID() + " / DB error: " + error);
         });
   }

   confirmConfiguration(name, enabled, value)
   {
      //Try to get this configuration 
      var user_config = this.getConfiguration(name);

      //Build configuration data structure
      var tracker_config = 
      {
         enabled: (parseInt(enabled) > 0 ? true : false),
         name: name, 
         priority: 2,
         status: 
         {
               finished: true,
               datetime: new Date(),
               description: "Configuração confirmada pelo dispositivo",
               step: "SUCCESS"
         },
         value: (value ? value : null)
      }

      //Check if tracker configuration matches user configuration (if exists)
      if(user_config == null || (this.configEquals(user_config, tracker_config) && !user_config.status.finished))
      {
         //Update tracker configuration
         tracker_config.status.finished = true;

         //Insert configuration on DB if user has not set configuration yet
         this.getDB()
            .collection('Tracker/' + this.getID() + '/Configurations')
            .doc(tracker_config.name)
            .set(tracker_config, {merge: true})
         .then(() => 
         {
            //Log debug
            logger.debug("Configuration '" + tracker_config.name + "' confirmed by tracker ST940@" + this.getID() + " successfully.");
         })
         .catch(error => 
         {
            //Log error
            logger.error("Error updating configuration retrieved from tracker " + this.getID() + " on database: " + error);
         });
      }
      else if(!user_config.status.finished)
      {
         //Log warn
         logger.warn("Configuration '" + tracker_config.name + "' retrieved from tracker " + this.getID() + " is different from user defined configuration.");
      }
   }

   confirmCommand(command_name)
   {
      //Try to get command from pending list
      var command = this.getPendingCommands()[command_name];

      //If this command was pending
      if(command)
      {
         //Call method to update progress
         this.updateConfigProgress(1, command.description, "Confirmado pelo rastreador às " + moment().format("HH:mm - DD/MM"), command_name);
      }
      else
      {
         //Else, call method to check if there is any pending command
         this.applyConfigurations();
      }
   }

   configEquals(config1, config2)
   {
      //Check if both are enabled or disabled
      if(config1.enabled == config2.enabled)
      {
         if(!config1.value)
         {
            //Return true if both are null
            return !config2.value;
         }
         else if(config2.value)
         {
            //Return true if both have same value
            return config1.value.trim() === config2.value.trim();
         }
      }

      //Otherwise, configs are diferent, return false
      return false;
   }

   insert_coordinates(tracker_params, coordinate_params, msg_code)
   {
      //Check msg code sent by the tracker
      if(msg_code == "1")
       {
           //Shock emergency alert
           super.insert_coordinates(tracker_params, coordinate_params, 
           {
               topic: 'Notify_ShockEmergency',
               title: 'Alerta de vibração',
               content: 'Vibração detectada pelo dispositivo'
           });
       }
       else if(msg_code == "2")
       {
           //SOS button pressed
           super.insert_coordinates(tracker_params, coordinate_params, 
           {
               topic: 'Tracker_SOS',
               title: 'Alerta de emergência (SOS)',
               content: 'Botão de SOS pressionado no dispositivo'
           });
       }
       else if(msg_code == "56")
       {
           //SOS button pressed
           super.insert_coordinates(tracker_params, coordinate_params, 
           {
               topic: 'Notify_Magnet',
               title: 'Alerta de magnetismo',
               content: 'Base magnética próxima ao dispositivo'
           });
       }
       else if(msg_code == "57")
       {
           //SOS button pressed
           super.insert_coordinates(tracker_params, coordinate_params, 
           {
               topic: 'Notify_Magnet',
               title: 'Alerta de magnetismo',
               content: 'Base magnética removida do dispositivo'
           });
       }
       else if(msg_code == "58")
       {
           //SOS button pressed
           super.insert_coordinates(tracker_params, coordinate_params, 
           {
               topic: 'Notify_LowBattery',
               title: 'Alerta de bateria fraca',
               content: 'Nível de bateria abaixo do ideal'
           });
       }
       else
       {
         //Insert coordinates on DB with default notification params
         super.insert_coordinates(tracker_params, coordinate_params);
       }
   }
}

module.exports = ST940