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

   checkConfigurations(new_connection)
   {
      //Check if tracker has any configuration available
      if(this.getConfigurationsCount() > 0)
      {
         //Check if tracker has pending configurations
         if(this.getPendingConfigs().length > 0)
         {
            //Check if there is any pending configuration
            if(!this.get("lastConfiguration"))
            {    
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
                              command: "REPORT;" 
                                 + this.getID() + ";" 
                                 + this.getConfiguration("UpdateIdle").enabled ? this.getConfiguration("UpdateIdle") : "0" + ";"
                                 + this.getConfiguration("UpdateActive").enabled ? this.getConfiguration("UpdateActive").value : "0" + ";60;3;0.10",
                              description: "Configurando: parâmetros de atualização"
                           });

                           break;
                  }
               }

               //Update tracker to indicate pending configuration
               this.getDB().doc('Tracker/' + this.getID()).update(
               {
                  lastConfiguration:  
                  {
                     progress: 0,
                     step: "PENDING",
                     description: "Configuração pendente",
                     status: "Aguardando conexão com rastreador",
                     pending: this.getPendingCommandsCount(),
                     server: this.getServerName(),
                     datetime: new Date()
                  },
                  lastUpdate: new Date()
               })
               .then(() => 
               {
                  //Run method to execute configurations
                  this.applyConfigurations();
               });
            }
            else
            {
               //Log info
               logger.debug("Tracker ST940@" + this.getID() + " configurations waiting for connection.")
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

   updateConfigProgress(config_progress, config_description, status_description)
   {
      //Try to get total pending configuration count
      var pending = this.get('lastConfiguration').pending;

      //Check if there is any pending configuration
      if(pending)
      {
         //Calculate configuration progress 
         var progress = ((pending - this.getPendingCommandsCount() + config_progress) * 100 / pending).toFixed(0);
   
         //Update tracker to indicate pending configuration
         this.getDB().doc('Tracker/' + this.getID()).update(
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
            //Log info
            logger.info("Tracker ST910@" + this.getID() + " update: " + config_description);
         })
         .catch(error =>
         {
            //Log error
            logger.error("Error updating configuration progress: " + error);
         });    
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
            this.updateConfigProgress(0.5, pending.description, "Comando enviado ao rastreador");
         }
      }
      else if(this.get("lastConfiguration").step == "PENDING")
      {
         //Initialize last update result
         var lastConfiguration = 
         {
             step: "SUCCESS", 
             description: "Configuração bem sucedida",
             status: "Processo finalizado às " + moment().format("hh:mm - DD/MM"),
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
                  logger.info('Configurations on tracker ' + this.get('name') + ' finished successfully, updating status...');

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

   parseData(data)
   {
      //"ST910;Emergency;696478;500;20180201;12:26:55;-23.076226;-054.206427;000.367;000.00;1;4.1;0;1;02;1865;c57704f358;724;18;-397;1267;255;3;25\r"
      if(data[0] === "ST910" && (data[1] === 'Emergency' || data[1] === 'Alert' || data[1] === 'Location'))
      {
         //Parse datetime
         var datetime =  moment.utc(data[4] + "-" + data[5], "YYYYMMDD-hh;mm;ss").toDate();

         //Parse coordinate
         var coordinates = this.getGeoPoint(parseFloat(data[6]), parseFloat(data[7]));

         //Parse speed
         var speed = data[8];

         //Battery level
         var batteryLevel = ((parseFloat(data[11]) - 2.8) * 71).toFixed(0) + '%';

         //Define tracker params to be updated
         var tracker_params = 
         {
               batteryLevel: batteryLevel,
               signalLevel: 'N/D',
               lastCoordinate: 
               {
                  type: "GSM",
                  location: coordinates,
                  datetime: datetime
               },
               lastUpdate: new Date()
         };

         //Define coordinates params to be inserted/updated
         var coordinate_params = 
         {
               datetime: datetime,
               signalLevel: 'N/D',
               batteryLevel: batteryLevel,
               position: coordinates,
               speed: speed
         }

         //Insert coordinates on DB
         this.insert_coordinates(tracker_params, coordinate_params);
         
         //If emergency message type
         if(data[1] === 'Emergency')
         {
               //Send ACK command to tracker
               this.sendCommand('ACK');
         }
      }
      else if(data[1] === 'Alive')
      {
         //Log connection alive
         logger.info("Tracker ST940@" + this.getID() + " connected.");
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
               this.confirmConfiguration("DeepSleep", data[data.indexOf("SVC") + 10], data[data.indexOf("SVC") + 10]);

               //Get magnet alert configuration from response
               this.confirmConfiguration("Magnet", data[data.indexOf("SVC") + 3]);

               //Get
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
         }

         //Call method to confirm command response
         this.confirmCommand(data[2]);
      }
      else
      {
         //Unknown data received
         logger.warn("Unknown data received from tracker " + data.join(';'));
      }

      //Call method to execute next command (if exists)
      this.applyConfigurations();
   }

   sendCommand(command)
   {
      //Get tcp connection to tracker if available
      var connectionAvailable = this.getConnection();

      //Check if available
      if(connectionAvailable)
      {
         try
         {
               //Send command to tracker
               connectionAvailable.write('AT^ST910;'+ command);

               //Log data
               logger.debug('ST940@' + this.getID() + ' (' + connectionAvailable.remoteAddress + ') <- [AT^ST910;' + command + "]");

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
         logger.debug('ST940@' + this.getID() + " have pending commands but it's not available.");
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
               completed: false,
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
               completed: true,
               datetime: new Date(),
               description: "Configuração confirmada pelo dispositivo",
               step: "SUCCESS"
         },
         value: (value ? value : null)
      }

      //Check if tracker configuration matches user configuration (if exists)
      if(user_config == null || (user_config.enabled == tracker_config.enabled && user_config.value == tracker_config.value))
      {
         //Insert configuration on DB if user has not set configuration yet
         this.getDB()
            .collection('Tracker/' + this.getID() + '/Configurations')
            .doc(tracker_config.name)
            .set(tracker_config, {merge: true})
         .then(() => 
         {
            //Log debug
            logger.debug("Configuration '" + tracker_config.name + "' retrieved from tracker " + this.getID() + " successfully.");
         })
         .catch(error => 
         {
            //Log error
            logger.error("Error updating configuration retrieved from tracker " + this.getID() + " on database: " + error);
         });
      }
   }

   confirmCommand(command_name)
   {
      //Try to get command from pending list
      var command = this.getPendingCommand(command_name);

      //If this command was pending
      if(command)
      {
         //Remove command from pending list
         delete this.getPendingCommands()[command_name];

         //Call method to update progress
         this.updateConfigProgress(1, command.description, "Confirmado pelo rastreador");
      }
   }
}

module.exports = ST940