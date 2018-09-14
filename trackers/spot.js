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
         this.getDB().doc('Trackers/' + this.getID()).update(
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
      var coordinates = this.getGeoPoint(parseFloat(message.latitude), parseFloat(message.longitude));

      //Parse datetime
      var datetime = moment.utc(message.dateTime, "YYYY-MM-DDThh:mm:ss").toDate();

      //Parse speed
      var speed = (message.messageType === ("NEWMOVEMENT") ? "Em movimento" : "Parado");

      //Parse battery level
      var batteryLevel = (message.batteryState === "GOOD" ? "OK" : "Baixo");

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
         id: message.id,
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
               description: "Obtendo dados do rastreador",
               status: "Atualizando histórico de coordenadas",
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
      setTimeout(this.insert_coordinates.bind(this), current*1000, tracker_params, coordinate_params, message.messageType, message.batteryState === "LOW");
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
         this.getDB().doc('Trackers/' + this.getID()).update(
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
   }

   insert_coordinates(tracker_params, coordinate_params, message_type, low_battery)
   {
      //Check if tracker is still in initial configuration mode
      if(this.get('lastConfiguration') == null || this.get('lastConfiguration').step != "SUCCESS")
      {
         //Insert coordinates on DB and build move alert notification
         super.insert_coordinates(tracker_params, coordinate_params, { suppress: true });
      }
      else if(message_type == 'NEWMOVEMENT')
      {
         //Insert coordinates on DB and build move alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
            topic: 'Notify_Functioning',
            title: 'Alerta de movimentação',
            content: (low_battery ? '(Atenção: Nível baixo de bateria)' : 'Rastreador detectou movimentação')
         });
      }
      else if(message_type == 'STOP')
      {
         //Insert coordinates on DB and build move alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
            topic: 'Notify_Stopped',
            title: 'Notificação de permanência',
            content: (low_battery ? '(Atenção: Nível baixo de bateria)' : 'Rastreador não detectou movimentação.')
         });
      }
      else if(message_type == 'STATUS')
      {
         //Insert coordinates on DB and build speed alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
               topic: 'Notify_Functioning',
               title: 'Notificação de funcionamento',
               content: (low_battery ? '(Atenção: Nível baixo de bateria)' : 'Rastreador funcionando corretamente.')
         });
      }
      else if(message_type == 'UNLIMITED-TRACK' && low_battery)
      {
         //Insert coordinates on DB and build speed alert notification
         super.insert_coordinates(tracker_params, coordinate_params, 
         {
               topic: 'Notify_LowBattery',
               title: 'Alerta de bateria fraca',
               content: 'Bateria do rastreador em nível baixo'
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