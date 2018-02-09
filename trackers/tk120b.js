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
        super(id, sms_parser, google_services)
    }

    checkConfigurations()
    {
        //Get current date time
        var currentDate = new Date();

        //Get last update on this tracker
        var lastUpdate = this.get('lastUpdate');

        //Check if an update is requested, or if last update caused an error on a diferent server, or if last update occurred more then half our ago
        if(lastUpdate.status === "REQUESTED" || (lastUpdate.status == "ERROR" && lastUpdate.server != this.getServerName()) || currentDate - lastUpdate.datetime > 1000*60*10)
        {
            //For each available configuration from this tracker
            for (let config of this._configurations)
            {
                //If this particular config is not completed, or last update on this config is more than one day
                if(config.status.step === "REQUESTED" || config.status.step === "ERROR" || currentDate - config.status.datetime > (1000*60*60*24))
                {
                    //Update config status
                    config.status.step = "PENDING";

                    //Add this configuration to be executed
                    this._pending_configs.push(config);
                    
                    //Log info
                    logger.debug("Tracker " + this.get('name') + " config '" + config.name + "' is marked as pending.");                    
                }
                else
                {
                    //Log info
                    logger.debug("Tracker " + this.get('name') + " config '" + config.name + "' is up to date.")
                }
            };

            //Check if there is any pending configuration
            if(this._pending_configs.length > 0)
            {
                //Initialize a new update
                lastUpdate.status = "PENDING";
                lastUpdate.server = this.getServerName();
                lastUpdate.datetime = currentDate;

                //Update tracker to indicate pending configuration
                this.getDB().doc('Tracker/' + this.getID()).update('lastUpdate', lastUpdate);

                //Run method to execute configurations
                this.applyConfigurations();
            }
            else
            {
                logger.info("Configuration check finished on tracker " + this.get('name') + ": No updates required.")
            }
        }
        else
        {
            //Log info
            logger.debug("Tracker " + this.get('name') + " configuration is not currently required. (Last: " + ((currentDate - lastUpdate.datetime) / (1000 * 60)).toFixed(2) + " mins ago / Result: " + lastUpdate.status + ")");
        }
    }

    applyConfigurations()
    {
        //Save context
        var self = this;

        //Try to get first current pending configuration
        var configuration = this._pending_configs.pop();

        //If there are no pending configurations
        if(!configuration)
        {
            //Initialize last update result
            var lastUpdate = {server: this.getServerName(), status: "SUCCESS", datetime: new Date()}

            //For each configuration available on this tracker
            for(let config of this._configurations)
            {
                //Check if any error ocurred
                if(config.status.step == "ERROR")
                {           
                    //Update tracker to indicate configuration finished
                    lastUpdate.status = "ERROR";
                }
            }
            
            //Update tracker to indicate configuration finished
            this.getDB()
            .collection('Tracker')
            .doc(this.getID())
            .update('lastUpdate', lastUpdate)
            .then(() => 
            {
                //Check no errors ocurred during update
                if(lastUpdate.status == "SUCCESS")
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
        else
        {
            //Command to be sent by SMS to this tracker
            var command;

            //Check configuration name
            switch(configuration.name)
            {
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
                        //No command required, config completed
                        configuration.status.command = '';
                        configuration.status.completed = true;
                        configuration.status.step = 'SUCCESS';
                        configuration.status.description = "Status: Configuração desativada com sucesso.";
                        configuration.status.datetime = new Date();

                        //Save data on firestore DB
                        this.getDB()
                            .collection("Tracker/" + this.getID() + "/Configurations")
                            .doc(configuration.name)
                            .set(configuration);

                        //Call recursive method to execute any pending configurations
                        this.applyConfigurations();

                        //End method
                        return;
                    }
                    break;

                default:
                    //Config unknown, send default
                    command = configuration.name + ' ' + configuration.value;
                    break;
            }

            //Update tracker to indicate configuration finished
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
                    configuration.status.description = "Status: Mensagem enviada ao rastreador...";
                    configuration.status.command = result.text;
                    configuration.status.datetime = new Date();
                }
                else
                {
                    //Update configuration data on SMS successfully sent
                    configuration.status.step = "ERROR";
                    configuration.status.description = "Status: Erro ocorrido ao enviar mensagem para o rastreador.";
                    configuration.status.datetime = new Date();

                    //Log info
                    logger.error("Tracker config '" + configuration.name + "' failed: " + result);
                }

                //Save data on firestore DB
                this.getDB()
                    .collection("Tracker/" + this.getID() + "/Configurations")
                    .doc(configuration.name)
                    .set(configuration);

                //Call recursive method to execute any pending configurations
                this.applyConfigurations();
            });
        }
    }

    confirmConfiguration(configName, enabled)
    {
        for(let config of this.getConfigurations())
        {
            if(config.name == configName)
            {
                //Change configuration status
                config.enabled = enabled;
                config.status.step = "SUCCESS";
                config.status.description = "Status: Configuração confirmada com sucesso em " + moment().format('DD/MM - hh:mm');
                config.status.completed = true;
                config.status.datetime = new Date();

                //Save message on firestore DB
                this.getDB()
                    .collection("Tracker/" + this.getID() + "/Configurations")
                    .doc(config.name)
                    .set(config)
                    .then(function () 
                    {
                        // Message already saved on DB, delete from modem memmory
                        logger.info("Tracker " + this.get('name') + " config '" + configName + "' successfully executed.")

                    }.bind(this));
            }
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
                    content: "SMS enviado pelo rastreador foi recebido.",
                    expanded: "SMS enviado pelo rastreador foi recebido: \n\n" + sms.text.replace(/\0/g, ''),
                    datetime: sms.time.getTime().toString()
                });

                //Check if text is response from a configuration
                if(sms_text.includes('notn ok!'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('PeriodicUpdate', false);
                }
                else if(sms_text.includes("***n ok!"))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('PeriodicUpdate', true);
                }
                else if(sms_text.includes('noshock ok!'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('Shock', false);
                }
                else if(sms_text.includes('shock ok!'))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('Shock', true);
                }
                else if(sms_text.includes('nomove ok!'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('MoveOut', false);
                }
                else if(sms_text.includes('move ok!'))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('MoveOut', true);
                }
                else if(sms_text.includes('nospeed ok!'))
                {
                    //Confirm configuration disabled
                    this.confirmConfiguration('OverSpeed', false);
                }
                else if(sms_text.includes('speed ok!'))
                {
                    //Confirm configuration enabled
                    this.confirmConfiguration('OverSpeed', true);
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
                    this.confirmConfiguration("StatusCheck", true);
                    
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
                                }
                            };

                            //Define coordinates params to be inserted/updated
                            var coordinate_params = 
                            {
                                cell_id: requestParams.mcc + "_" + requestParams.mnc + "_" + requestParams.cid + "_" + requestParams.lac,
                                batteryLevel: this.get('batteryLevel'),
                                signalLevel: this.get('signalLevel'),
                                datetime: new Date(),
                                position: coordinates,
                                speed: "N/D"
                            }
                            
                            if(sms_text.startsWith("shock!"))
                            {
                                //Insert coordinates on DB and build shock alert notification
                                this.insert_coordinates(tracker_params, coordinate_params, 
                                {
                                    topic: 'Notify_Shock',
                                    title: 'Alerta de vibração',
                                    content: 'Vibração detectada pelo dispositivo.'
                                });
                            }
                            else
                            {
                                //Insert coordinates on db with default notification
                                this.insert_coordinates(tracker_params, coordinate_params);
                            }
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
                        }
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

                    //If this is an move alert message
                    if(sms_text.startsWith('move!'))
                    {
                        //Insert coordinates on DB and build move alert notification
                        this.insert_coordinates(tracker_params, coordinate_params, 
                        {
                            topic: 'Notify_MoveOut',
                            title: 'Alerta de evasão',
                            content: 'Movimentação além do limite determinado.'
                        });
                    }
                    else if(sms_text.startsWith("speed!"))
                    {
                        //Insert coordinates on DB and build speed alert notification
                        this.insert_coordinates(tracker_params, coordinate_params, 
                        {
                            topic: 'Notify_OverSpeed',
                            title: 'Alerta de velocidade',
                            content: 'Velocidade acima do limite determinado.'
                        });
                    }
                    else if(sms_text.startsWith("shock!"))
                    {
                        //Insert coordinates on DB and build shock alert notification
                        this.insert_coordinates(tracker_params, coordinate_params, 
                        {
                            topic: 'Notify_Shock',
                            title: 'Alerta de vibração',
                            content: 'Vibração detectada pelo dispositivo.'
                        });
                    }
                    else
                    {
                        //Insert coordinates on db with default notification
                        this.insert_coordinates(tracker_params, coordinate_params);
                    }
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

            //If report is indicating success
            if(delivery_report.status == "00")
            {
                //Set title and content
                notificationParams.title = "Alerta de disponibilidade";
                notificationParams.content = "Confirmou o recebimento de SMS";
            }
            else
            {
                //Set title and content
                notificationParams.title = "Alerta de indisponibilidade";
                notificationParams.content = "Rastreador não disponível para receber SMS";
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
    
}

module.exports = TK102B