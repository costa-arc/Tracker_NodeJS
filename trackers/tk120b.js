//Import logger module
const logger = require('../logs/logger');

//Import base tracker class
const Tracker = require('./tracker');

//Import date time parser
const moment = require('moment');

//Extends base tracker class
class TK102B extends Tracker
{
    constructor(id, sms_parser, google_services) 
    {
        //Call parent constructor
        super(id, sms_parser, google_services);
    }

    checkConfigurations()
    {
        //Get current date time
        var currentDate = new Date();

        //Get last update on this tracker
        var lastConfiguration = this.get('lastConfiguration');

        //Check if tracker has not been configured yet or if last configuration occurred more than an our ago
        if(lastConfiguration == null || currentDate - lastConfiguration.datetime > 1000*60*60)
        {
            //Check if there is any pending configuration
            if(this.getPendingConfigs().length > 0)
            {    
                //Update tracker to indicate pending configuration
                this.getDB().doc('Tracker/' + this.getID()).update('lastConfiguration', 
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
            else
            {
                logger.info("Configuration check finished on tracker " + this.get('name') + ": No updates required")
            }
        }
        else
        {
            //Log info
            logger.debug("Tracker " + this.get('name') + " configuration is not currently required. (Last: " + ((currentDate - lastConfiguration.datetime) / (1000 * 60)).toFixed(2) + " mins ago / Step: " + lastConfiguration.step + " / Description: " + lastConfiguration.status + ")");
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
                case "Reset":  
                    //INITIAL CONFIGURATION: Reset tracker previous configuration
                    command = "reset123456";
                    break;

                case "Begin":
                    //INITIAL CONFIGURATION: Initialize tracker
                    command = "begin123456";
                    break;

                case "Admin":
                    //INITIAL CONFIGURATION: Set this server as tracker admin
                    command = "admin123456 " + this.getParser().getPhoneNumber();
                    break;

                case "Location":
                    //Send SMS to configure shock alert
                    command = "smslink123456";
                    break;
                    
                case "MoveOut":
                    //Move out alert
                    command = (configuration.enabled ? 'move123456' : 'nomove123456');
                    break;

                case "OverSpeed":
                    //Speed limit alert
                    command = (configuration.enabled ? 'speed123456 ' + configuration.value : 'nospeed123456');
                    break;

                case "PeriodicUpdate":
                    //Send SMS to request position and define callback
                    command = (configuration.enabled ? 't' + configuration.value + '***n123456' : 'notn123456');
                    break;

                case "Shock":
                    //Send SMS to configure shock alert
                    command = (configuration.enabled ? 'shock123456': 'noshock123456');
                    break;

                case "StatusCheck":

                    //Send SMS to request status
                    if(configuration.enabled)
                    {
                        //Send command to request status update
                        command = 'check123456';
                    }
                    else
                    {
                        //No command required, config finished
                        this.confirmConfiguration("StatusCheck", false, 'ok');
                    }
                    break;

                default:
                    //Config unknown, send default
                    command = configuration.name + ' ' + configuration.value;
                    break;
            }

            //Log data
            logger.debug("Executing tracker " + this.get('name') + " config " + configuration.name + ": " + command);

            //Send SMS to request command
            this.getParser().send_sms(this, command, (sent, result) =>
            {
                //SMS successfully sent
                if(sent)
                {
                    //Save SMS sent on Firestore DB
                    this.getDB()
                    .collection("Tracker/" + this.get('identification') + "/SMS_Sent")
                    .doc(result.id)
                    .set(
                    {
                        server: self.getServerName(),
                        from: self.getParser().getPhoneNumber(),
                        text: result.text,
                        reference: result.reference,
                        sentTime: new Date(),
                        receivedTime: null,
                        status: 'ENROUTE'
                    })
                    .then(() =>
                    {
                        //Result sucess
                        logger.info("Config '" + configuration.name + "' sent to tracker " + self.get('name') + ": Reference: #" + result.reference + " -> Firestore ID: " +  result.id);
                    })
                    .catch(error => 
                    {
                        //Result error
                        logger.warn("Config '" + configuration.name + "' sent to tracker " + self.get('name') + ": Reference: #" + result.reference + " -> Could not save on firestore: " + error);
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
                    logger.error("Tracker config '" + configuration.name + "' failed: " + result);
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
                server: this.getServerName(),
                datetime: new Date()
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
                        logger.info('Configurations on tracker ' + self.get('name') + ' finished successfully, updating status...');
                    }
                    else
                    {
                        //Log error
                        logger.error('Configurations on tracker ' + self.get('name') + ' failed on this server, updating status...');
                    }
                })
                .catch(error =>
                {
                    //Log error
                    logger.error('Could not update tracker ' + self.get('name') + ' status on Firestore DB: ' + error);
                })
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
            if(response.includes('ok'))
            {
                //Show success message to user
                config.status.step = "SUCCESS";
                config.status.description = "Configuração concluída às " + moment().format("HH:mm - DD/MM");

                //Configuration completed, update progress
                this.updateConfigProgress(1, config.description, config.status.description);
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
            else if(response.includes("password err"))
            {
                //Show success message to user
                config.status.step = "ERROR";
                config.status.description = "Dispositivo recusou a senha em " + moment().format("HH:mm - DD/MM");

                //Reset configuration array
                this.resetPendingConfigs();

                //Call method to end configurations
                this.applyConfigurations();
            }

            //Update configuration status on firestore DB
            this.getDB()
                .collection("Tracker/" + this.getID() + "/Configurations")
                .doc(config.name)
                .set(config)
                .then(() =>
                {
                    // Message already saved on DB, delete from modem memmory
                    logger.info("Tracker " + this.get('name') + " config '" + configName + "' successfully executed")

                });
        }
    }

    parseData(type, data)
    {
        if(type === "sms_received")
        {
            //Get content from parser
            var sms = data.content;

            //If it is a delivery confirmation 
            if(sms.text.indexOf('entregue') > 0)
            {
                //Just log data (delivery report is handled it's own method)
                logger.debug('Received SMS delivery report from ' + this.get('name'));
                
                //Message not relevant, delete from memmory
                this.getParser().deleteMessage(sms);
            }
            else
            {
                //Remove null bytes from string
                var sms_text = sms.text.replace(/\0/g, '')

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
                    expanded: "SMS enviado pelo rastreador foi recebido: \n\n" + sms.text.replace(/\0/g, ''),
                    datetime: sms.time.getTime().toString()
                });

                //Check if text is response from a configuration
                if(sms_text.includes('notn ok'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('PeriodicUpdate', false, sms_text);
                }
                else if(sms_text.includes("***n"))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('PeriodicUpdate', true, sms_text);
                }
                else if(sms_text.includes('noshock ok'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('Shock', false, sms_text);
                }
                else if(sms_text.includes('shock '))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('Shock', true, sms_text);
                }
                else if(sms_text.includes('nomove ok'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('MoveOut', false, sms_text);
                }
                else if(sms_text.includes('move '))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('MoveOut', true, sms_text);
                }
                else if(sms_text.includes('nospeed ok'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('OverSpeed', false, sms_text);
                }
                else if(sms_text.includes('speed '))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('OverSpeed', true, sms_text);
                }
                else if(sms_text.includes('RESET '))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('Reset', true, sms_text);
                }
                else if(sms_text.includes('begin '))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('Begin', true, sms_text);
                }
                else if(sms_text.includes('admin '))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('Admin', true, sms_text);
                }
                else if(sms_text.includes('password err'))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('StatusCheck', true, sms_text);
                }
                else if(sms_text.includes('help me! ok!'))
                {
                  //Confirm configuration enabled
                  logger.info("Successfully disabled SOS alert from tracker " + this.get('name'));
                }
                else if(sms_text.includes('low battery! ok!'))
                {
                  //Confirm configuration enabled
                  logger.info("Successfully disabled low battery alert from tracker " + this.get('name')); 
                }
                else if(sms_text.startsWith('GSM: '))
                {
                    //Get signal level from SMS text
                    var index = sms_text.indexOf('GSM: ') + 'GSM: '.length;
                    var signal_level = parseInt(sms_text.substring(index, sms_text.substring(index).indexOf('%') + index)) + "%";

                    //Get battery level from SMS text
                    index = sms_text.indexOf('BATTERY: ') + 'BATTERY: '.length;
                    var battery_level = parseInt(sms_text.substring(index, sms_text.substring(index).indexOf('%') + index)) + "%";

                    //Update value on firestore DB
                    this.getDB().doc("Tracker/" + this.getID()).update({
                        signalLevel: signal_level,
                        batteryLevel: battery_level
                    });

                    //Send notification to users subscribed on this topic
                    this.sendNotification("Notify_StatusCheck", {
                        title: "Atualização diária de status",
                        content: "Bateria: " + battery_level + " / Sinal GSM: " + signal_level,
                        datetime: sms.time.getTime().toString()
                    });

                    //Status check configuration successfully applied
                    this.confirmConfiguration("StatusCheck", true, 'ok');
                    
                    //Log info
                    logger.info('Successfully parsed status message from: ' + this.get('name'));
                }
                else if(sms_text.indexOf('lac') >= 0 && sms_text.indexOf('mnc') >= 0)
                {
                    //Initialize request params array
                    var requestParams = {};

                    //Get LAC from SMS text
                    var index = sms_text.indexOf('lac');
                    index += sms_text.substring(index).indexOf(':') + 1
                    requestParams.lac = sms_text.substring(index, sms_text.substring(index).match(/\D/)["index"] + index);

                    //Get CID from SMS text
                    index = sms_text.indexOf('cid');
                    index += sms_text.substring(index).indexOf(':') + 1
                    requestParams.cid = sms_text.substring(index, sms_text.substring(index).match(/\D/)["index"] + index);

                    //Get MCC from SMS text
                    index = sms_text.indexOf('mcc');
                    index += sms_text.substring(index).indexOf('=') + 1
                    requestParams.mcc = sms_text.substring(index, sms_text.substring(index).match(/\D/)["index"] + index);
                    
                    //Get MNC from SMS text
                    index = sms_text.indexOf('mnc');
                    index += sms_text.substring(index).indexOf('=') + 1
                    requestParams.mnc = sms_text.substring(index, sms_text.substring(index).match(/\D/)["index"] + index);

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
                                batteryLevel: this.get('batteryLevel'),
                                signalLevel: this.get('signalLevel'),
                                datetime: new Date(),
                                position: coordinates,
                                speed: "N/D"
                            }
                            
                            //Insert coordinates on db with default notification
                            this.insert_coordinates(tracker_params, coordinate_params, sms_text);

                            //Confirm location configuration (if requested by user)
                            this.confirmConfiguration("Location", true, "ok");
                        } 
                        else 
                        {
                            //Log error
                            logger.error("Failed to geolocate data from GSM cell tower", requestParams);
                        }

                    });
                }
                else if(sms_text.indexOf('lat') >= 0)
                {
                    //Get latitude from SMS text
                    var index = sms_text.indexOf('lat:') + 'lat:'.length;
                    var latitude = sms_text.substring(index, sms_text.substring(index).indexOf(' ') + index);

                    //Get longitude from SMS text
                    index = sms_text.indexOf('long:') + 'long:'.length;
                    var longitude = sms_text.substring(index, sms_text.substring(index).indexOf(' ') + index);

                    //Get speed from SMS text
                    index = sms_text.indexOf('speed:') + 'speed:'.length;
                    var speed = sms_text.substring(index, sms_text.substring(index).indexOf(' ') + index);

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
                        lastUpdate: new Date()
                    };

                    //Define coordinates params to be inserted/updated
                    var coordinate_params = 
                    {
                        batteryLevel: this.get('batteryLevel'),
                        signalLevel: this.get('signalLevel'),
                        datetime: new Date(),
                        position: coordinates,
                        speed: speed
                    }

                    //Insert coordinates on db
                    this.insert_coordinates(tracker_params, coordinate_params, sms_text);

                    //Confirm location configuration (if requested by user)
                    this.confirmConfiguration("Location", true, "ok");
                }
                else
                {
                    //Log warning
                    logger.warn("Unable to parse message from TK102B model:  " + sms_text);
                }
            }
        }
        else if (type === 'delivery_report')
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
                    .collection('Tracker/' + this.getID() + '/SMS_Sent')
                    .doc(sms.id)
                    .update(
                    {
                        receivedTime: new Date(),
                        status: 'DELIVERED'
                    });
            } 

            //Send notification
            this.sendNotification("Notify_Available", notificationParams);

            //Log data
            logger.info("Received delivery report from " + this.get('name'));
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
            var progress = ((pending - this.getPendingConfigs().length + config_progress) * 100 / pending).toFixed(0);
    
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

    insert_coordinates(tracker_params, coordinate_params, sms_text)
    {
        //If this is an move alert message
        if(sms_text.startsWith('move!'))
        {
            //Insert coordinates on DB and build move alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: 'Notify_MoveOut',
                title: 'Alerta de evasão',
                content: 'Movimentação além do limite determinado.'
            });
        }
        else if(sms_text.startsWith("speed!"))
        {
            //Insert coordinates on DB and build speed alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: 'Notify_OverSpeed',
                title: 'Alerta de velocidade',
                content: 'Velocidade acima do limite determinado.'
            });
        }
        else if(sms_text.startsWith("shock!"))
        {
            //Insert coordinates on DB and build shock alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: 'Notify_Shock',
                title: 'Alerta de vibração',
                content: 'Vibração detectada pelo dispositivo.'
            });
        }
        else if(sms_text.startsWith("Help me!"))
        {
            //Insert coordinates on DB and build shock alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
               topic: 'Tracker_SOS',
               title: 'Alerta de emergência (SOS)',
               content: 'Botão de SOS pressionado no dispositivo'
            });

            //Send command to disable SOS alarm
            this.disableAlert("help me");
        }
        else if(sms_text.startsWith("Low Battery!"))
        {
            //Insert coordinates on DB and build shock alert notification
            super.insert_coordinates(tracker_params, coordinate_params, 
            {
                topic: 'Notify_LowBattery',
                title: 'Alerta de bateria fraca',
                content: 'Nível de bateria abaixo do ideal'
            });

            //Send command to disable low battery alert
            this.disableAlert("low battery123456");
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
      logger.debug("Sending '" + command + "' to disable alert from tracker" + this.get('name'));

      //Send SMS to request command
      this.getParser().send_sms(this, command, (sent, result) =>
      {
         //SMS successfully sent
         if(sent)
         {
            //Save SMS sent on Firestore DB
            this.getDB()
            .collection("Tracker/" + this.get('identification') + "/SMS_Sent")
            .doc(result.id)
            .set(
            {
               server: this.getServerName(),
               from: this.getParser().getPhoneNumber(),
               text: result.text,
               reference: result.reference,
               sentTime: new Date(),
               receivedTime: null,
               status: 'ENROUTE'
            })
            .then(() =>
            {
               //Result sucess
               logger.info("Sent '" + command + "' command to tracker " + this.get('name') + ": Reference: #" + result.reference + " -> Firestore ID: " +  result.id);
            })
            .catch(error => 
            {
               //Result warning
               logger.warn("Command '" + command + "' sent to tracker " + this.get('name') + ": Reference: #" + result.reference + " -> Could not save on firestore: " + error);
            }); 
         }
         else
         {
            //Result error
            logger.error("Could not disable alert from tracker " + this.get('name') + ", error sending SMS: " + error);
         }
      });
    }
    
}

module.exports = TK102B