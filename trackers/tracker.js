//Import logger module
const logger = require('../logs/logger');

//Import date time parser
const moment = require('moment');

//Base class for any supported tracker device (does not implement configuration and parsing methods)
class Tracker 
{
    constructor(id, parser, google_services) 
    {
        this._id = id;
        this._parser = parser;
        this._google_services = google_services;
        this._configurations = {};
        this._pending_configs = [];
    }

    //Load tracker data
    loadData(data)
    {
        //Save on a local variable
        this._data = data;
    }

    //Update value on tracker
    set(key, value) 
    {
        //Set value on selected key
        this._data.set(key, value);
    }
    
    //Get data from tracker
    get(value) 
    {
        return this._data.get(value);
    }

    //Get tracker identification
    getID()
    {
        return this._id;
    }

    //Get SMS parser
    getParser()
    {
        return this._parser;
    }

    //Get current server name
    getServerName()
    {
        return this.getParser()._server_name;
    }

    //Get Firestore Database
    getDB()
    {
        return this._google_services.getDB();
    }

    //Get google geolocation services
    getGeolocation()
    {
        return this._google_services.getGeolocation();
    }

    //Get google geocoding services
    getGeocoder()
    {
        return this._google_services.getGeocoder();
    }

    //Get Google services
    getGoogleServices()
    {
        return this._google_services;
    }

    //Get an Firestore.Geopoint object
    getGeoPoint(latitude, longitude)
    {
        //Get firestore from google servie
        var firestore = this._google_services.getFirestore();

        //Get firestore Geopoint using lat/lng params
        return new firestore.GeoPoint(latitude, longitude);
    }

    //Get Configuration array
    getConfigurations()
    {
        return this._configurations;
    }

    //Try to get configuration value
    getConfiguration(value)
    {
        return this._configurations[value];
    }

    //Get Pending configuration array
    getPendingConfigs()
    {
        return this._pending_configs
    }

    //Set Configuration array
    setConfigurations(value)
    {
        this._configurations = value;
    }

    //Set Pending configuration array
    setPendingConfigs(value)
    {
        this._pending_configs = value;
    }

    //Send notification using Google Firebase Cloud Messaging
    sendNotification(topic, params, override_params)
    {
        //Call method from google services
        this.getGoogleServices().sendNotification(this.getID(), topic, params, override_params);
    }

    //Load configurations from array
    loadConfigFromDB() 
    {
        //Load configuration from trackers
        this.getDB()
        .collection("Tracker/" + this.getID() + "/Configurations")
        .orderBy("priority", 'desc')
        .get()
        .then(result =>
        {
            //Initialize configuration array
            this.setConfigurations({});

            //Initialize pending configuration array
            this.setPendingConfigs([]);

            //For each config load from DB
            result.forEach(config => 
            {
                //Get configuration data
                config = config.data();

                //Append configuration to array
                this.getConfigurations()[config.name] = config;

                //Check configuration status
                if(config.status.step != "SUCCESS")
                {
                    //Append to pending configuration array
                    this.getPendingConfigs().push(config);
                }
            });

            //Log data
            logger.debug(this.get('name') + " configs loaded (" + Object.keys(this.getConfigurations()).length + " total / " + this.getPendingConfigs().length + " pending)")

            //Perform initial configuration check
            this.checkConfigurations();

        })
        .catch(error => 
        {
            //Log error message
            logger.error("Error getting tracker configuration: " + error.stack);
        });
    }

    checkConfigurations()
    {
        
    }

    applyConfigurations()
    {
        
    }

    confirmConfiguration(configName, enabled)
    {
        for(let config of this.getConfigurations())
        {
            if(config.name == configName)
            {
                //Change configuration status
                config.status.step = "SUCCESS";
                config.status.description = "Status: Configuração confirmada com sucesso em " + moment().format('dd/MM - hh:mm');
                config.status.completed = true;
                config.status.enabled = enabled;
                config.status.datetime = currentDate;

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
        
    }
    
    //Return the distance in meters between to coordinates
    getDistance(coordinates1, coordinates2) 
    {
        // Math.PI / 180
        var p = 0.017453292519943295;

        // Calculatedistance
        var a = 0.5 - 
                Math.cos((coordinates2.latitude - coordinates1.latitude) * p)/2 + 
                Math.cos(coordinates1.latitude * p) * Math.cos(coordinates2.latitude * p) * 
                (1 - Math.cos((coordinates2.longitude - coordinates1.longitude) * p))/2;

        // 2 * R; R = 6371 km
        return 12742000 * Math.asin(Math.sqrt(a)); 
    }
  
    //Function to insert coordinates received by this tracker on DB
    insert_coordinates(tracker_params, coordinate_params, notification)
    {
        //Save tracker context
        var self = this;

        //Update tracker
        this.getDB()
        .collection('Tracker')
        .doc(this.getID())
        .set(tracker_params, { merge: true })
        .then(() => 
        {
            //Get latest coordinate from this tracker
            this.getDB()
            .collection('Tracker/' + this.getID() + '/Coordinates')
            .orderBy('datetime', 'desc')
            .where('datetime', '<=', coordinate_params.datetime)
            .limit(1)
            .get()
            .then((querySnapshot) =>
            {
                //Get result from query
                var lastCoordinate = querySnapshot.docs[0];
                
                //If no coordinates available or the distance is less than 50 meters from current position
                if(lastCoordinate == null || this.getDistance(coordinate_params.position, lastCoordinate.data().position) > 50)
                {
                    //Get coordinate ID if available
                    var coordinate_id = (coordinate_params.id ? coordinate_params.id : moment(new Date()).format('YYYY_MM_DD_hh_mm_ss_SSS'));
                    
                    //Log data
                    logger.debug("Requesting reverse geocoding", coordinate_params.position);

                    //Revert geocode coordinates -> textual address
                    self.getGeocoder().reverse({
                        lat: coordinate_params.position.latitude, 
                        lon: coordinate_params.position.longitude
                    })
                    .then((result) =>
                    {
                        //Save geocoding result (textual address)
                        coordinate_params.address = result[0].formattedAddress;

                        //Insert coordinates with geocoded address
                        self.getDB()
                            .collection('Tracker/' + self.getID() + "/Coordinates")
                            .doc(coordinate_id)
                            .set(coordinate_params)
                        
                        //Send notification to users subscribed on this topic
                        self.sendNotification("Notify_Movement", {
                            title: "Alerta de movimentação",
                            content: coordinate_params.address,
                            coordinates: coordinate_params.position.latitude + "," + coordinate_params.position.longitude,
                            datetime: Date.now().toString()
                        }, notification);

                        //Log info
                        logger.info('Successfully parsed location message from: ' + self.getID() + " - Coordinate inserted");
                    })
                    .catch((error) =>
                    {  
                        //Error geocoding address
                        coordinate_params.address = "Endereço próximo à coordenada não disponível.";

                        //Insert coordinates without geocoded address
                        self.getDB()
                            .collection('Tracker/' + self.getID() + "/Coordinates")
                            .doc(coordinate_id)
                            .set(coordinate_params)

                        //Send notification to users subscribed on this topic
                        self.sendNotification("Notify_Movement", {
                            title: "Alerta de movimentação",
                            content: "Coordenadas: " + coordinate_params.position.latitude + "," + coordinate_params.position.longitude,
                            coordinates: coordinate_params.position.latitude + "," + coordinate_params.position.longitude,
                            datetime: Date.now().toString()
                        }, notification);

                        //Log warning
                        logger.warn('Parsed location message from: ' + this.getID() + " - Geocoding failed: " + error);
                    }); 
                }
                else
                {
                    //Save current date time (updating last coordinate)
                    coordinate_params.lastDatetime = coordinate_params.datetime;

                    //Remove datetime from params to preserve initial coordinate datetime
                    delete coordinate_params.datetime;

                    //Current coordinates is too close from previous, just update last coordinate
                    self.getDB()
                        .collection('Tracker/' + self.getID() + "/Coordinates")
                        .doc(lastCoordinate.id)
                        .update(coordinate_params);

                    //Send notification to users subscribed on this topic
                    self.sendNotification("Notify_Stopped", {
                        title: "Alerta de permanência",
                        content: "Rastreador permanece na mesma posição.",
                        coordinates: coordinate_params.position.latitude + "," + coordinate_params.position.longitude,
                        datetime: Date.now().toString()
                    }, notification);
                    
                    //Log info
                    logger.info('Successfully parsed location message from: ' + self.get('name') + " - Coordinate updated");
                }
            })
            .catch((error) =>
            {
                //Log error
                logger.error("Error inserting coordinates on DB: " + error);
            });
        })
        .catch((error) =>
        {
            //Log error
            logger.error("Error updating tracker on DB: " + error);
        });
    }
}

module.exports = Tracker