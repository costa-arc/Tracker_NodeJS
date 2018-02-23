'use strict';

//Import logger module
const logger = require('../logs/logger');

//Import base tracker class
const Tracker = require('./tracker');

//Import date time parser
const moment = require('moment');

//Extends base tracker class
class SPOT extends Tracker
{
   constructor(id, http_parser, google_services) 
   {
      //Call parent constructor
      super(id, http_parser, google_services);
   }

   checkConfigurations()
   {
      //Check if tracker has any configuration process
      if(!this.get("lastConfiguration"))
      {    
         //Build last configuration status
         var lastConfiguration = 
         {
            progress: 0,
            step: "PENDING",
            description: "Buscando informações",
            status: "Processo iniciado às " + moment().format("HH:mm - DD/MM"),
            pending: 1,
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
            logger.info("Tracker SPOT@" + this.get('name') + " started configuration process");

            //Update locally last configuration value
            this.set('lastConfiguration', lastConfiguration);

            //Request parser to check updates from this tracker
            this.getParser().checkSPOT(this);
         });
      }
   }

   parseData(message, current, total)
   {
      //Create coordinate object
      var coordinates = this.getGeoPoint(parseFloat(message['latitude'][0]), parseFloat(message['longitude'][0]));

      //Parse datetime
      var datetime = moment.utc(message['dateTime'][0], "YYYY-MM-DDThh:mm:ss").toDate();

      //Parse speed
      var speed = (message['messageType'][0] === ("NEWMOVEMENT") ? "Em movimento" : "Parado");

      //Parse battery level
      var batteryLevel = (message["batteryState"][0] === "GOOD" ? "OK" : "Baixo");

      //Define tracker params to be updated
      var tracker_params = 
      {
         batteryLevel: batteryLevel,
         signalLevel: "100%",
         lastCoordinate: 
         {
            type: "GPS",
            datetime: datetime,
            location: coordinates
         },
         lastUpdate: datetime
      };

      //Define coordinates params to be inserted/updated
      var coordinate_params = 
      {
         id: message["id"][0],
         datetime: datetime,
         signalLevel: "100%",
         batteryLevel: batteryLevel,
         position: coordinates,
         speed: speed
      }

      //Check if this is the initial configuration process
      if(this.get('lastConfiguration') == null || this.get('lastConfiguration').step != "SUCCESS")
      {
         //Calculate configuration progress 
         var progress = (current * 100 / (total - 1)).toFixed(0);

         //Check if finished
         if(progress < 100)
         { 
            //Build progress status
            tracker_params.lastConfiguration = 
            {
               step: "PENDING",
               description: "Buscando informações",
               status: "Obtendo dados do rastreador",
               pending: total,
               progress: progress,
               server: this.getServerName(),
               datetime: new Date()
            };
         }
         else
         {
            //Build success configuration
            tracker_params.lastConfiguration = 
            {
               progress: 100,
               step: "SUCCESS", 
               description: "Configuração bem sucedida",
               status: "Processo finalizado às " + moment().format("HH:mm - DD/MM"),
               server: this.getServerName(),
               datetime: new Date()
            }
         }
      }

      //Insert coordinates (with delay only if multiple coordinates are being inserted)
      setTimeout(this.insert_coordinates.bind(this), current*1000, tracker_params, coordinate_params, message['messageType'][0]);
   }

   configError()
   {
      if(this.get('lastConfiguration') == null || this.get('lastConfiguration').step != "SUCCESS")
      {
         //Build last configuration status
         var lastConfiguration = 
         {
            progress: 0,
            step: "ERROR",
            description: "Falha ao buscar informações",
            status: "Erro ocorrido às " + moment().format("HH:mm - DD/MM"),
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
            logger.info("Tracker SPOT@" + this.get('name') + " started configuration process");

         });
      }
      
      //Flag indicating update operation finished
      this.updateInProgress = false;
   }

   insert_coordinates(tracker_params, coordinate_params, message_type)
   {
      //Check if tracker is still in initial configuration mode
      if(this.get('lastConfiguration') == null || this.get('lastConfiguration').step != "SUCCESS")
      {
         //Insert coordinates on DB and build move alert notification
         super.insert_coordinates(tracker_params, coordinate_params, { suppress: true });
      }
      else if(message_type.startsWith('move!'))
      {
         //Insert coordinates on DB and build move alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
               topic: 'Notify_MoveOut',
               title: 'Alerta de evasão',
               content: 'Movimentação além do limite determinado.'
         });
      }
      else if(message_type.startsWith("speed!"))
      {
         //Insert coordinates on DB and build speed alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
               topic: 'Notify_OverSpeed',
               title: 'Alerta de velocidade',
               content: 'Velocidade acima do limite determinado.'
         });
      }
      else if(message_type.startsWith("shock!"))
      {
         //Insert coordinates on DB and build shock alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
               topic: 'Notify_Shock',
               title: 'Alerta de vibração',
               content: 'Vibração detectada pelo dispositivo.'
         });
      }
      else
      {
         //Call super method using default notifications
         super.insert_coordinates(tracker_params, coordinate_params);
      }
   }
    
}

module.exports = SPOT