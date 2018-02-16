'use strict';

//Load service account from local JSON file
const moment = require('moment');

//Import logger module
const logger = require('./logs/logger');

//Import Google Services (Firebase, geocoding, geolocation)
const Google_Services = require('./google');

//Import local parsers
const HTTP_Module = require('./parsers/http');
const TCP_Module = require('./parsers/tcp');
const SMS_Module = require('./parsers/sms');

//Import tracker models
const TK102B = require('./trackers/tk120b');
const ST940 = require('./trackers/st940');

//Get process params
const tcp_port = 5001;
const com_port = process.argv[2];
const server_name = process.argv[3];

//Initialize Google services 
var google_services = new Google_Services("./credentials.json");

//Initialize HTTP Parser
var http_parser = new HTTP_Module();

//Initialize TCP Parser
var tcp_parser = new TCP_Module(server_name, tcp_port);

//Initialize SMS Parser
var sms_parser = new SMS_Module(server_name, com_port);

//Initialize tracker array
var trackers = {};

//Handle data comming from 
sms_parser.on('data', (type, data) => 
{
  //Check the source from data is a known tracker
  if(trackers[data.source])
  {
    //Call method to parse data
    trackers[data.source].parseData(type, data);
  }
  else if(type == "sms_received")
  {
    //Log warning
    logger.warn("Received SMS from unknown number");

    //Save on firestore DB global SMS Received collection
    google_services.getDB()
      .collection("SMS_Received")
      .doc(data.datetime)
      .set(
      {
        server: server_name,
        to: sms_parser.getPhoneNumber(), 
        from: data.content.sender,
        receivedTime: data.content.time,
        text: data.content.text.replace(/\0/g, '')
      });
    
    //Message already parsed, delete from memmory
    sms_parser.deleteMessage(data.content);
  }
  else if(type == "delivery_report")
  {
    //Log error
    logger.error("Received delivery report from unknown number: " + data.content.sender);
  }
});

//Handle data comming from 
tcp_parser.on('data', (tcp_socket, data) => 
{
  //Check the source from data is a known tracker
  if(trackers[data.source])
  {
    //Add tcp connection to tracker
    trackers[data.source].setConnection(tcp_socket);

    //Call method to parse data
    trackers[data.source].parseData(data.content);
  }
  else
  {
    //Check on DB if there is a tracker with this ID
    google_services.getDB()
      .doc("Tracker/" + data.source)
      .get()
      .then(docSnapshot => 
      {
        //if there is no tracker with this ID
        if (!docSnapshot.exists) 
        {
            //Log info
            logger.info("New tracker (ST940@" + data.source + ") detected, requesting current configuration.")
            
            //Initialize tracker array
            var tracker_params = {};

            //Else, create an entry on DB
            tracker_params.name = "ST940 - ID(" + data.source + ")";
            tracker_params.model = "st940";
            tracker_params.description = "Adicionado automaticamente";
            tracker_params.identification = data.source;
            tracker_params.lastUpdate = new Date();

            //Choose a random color to new tracker
            tracker_params.backgroundColor = ['#99ff0000', '#99ffe600', '#99049f1e', '#99009dff', '#9900ffee'][Math.floor((Math.random() * 4) + 1)];
            
            //Create a new tracker object
            trackers[data.source] = new ST940(data.source, tcp_parser, google_services);

            //Insert new tracker
            google_services.getDB()
              .collection('Tracker')
              .doc(data.source)
              .set(tracker_params, { merge: true })
              .then(() => 
              {
                //Add tcp connection to tracker
                trackers[data.source].setConnection(tcp_socket);

                //Call method to parse data
                trackers[data.source].parseData(data.content);
              });
          }
      });
  }
});

//Start monitoring trackers
monitorTrackers();

//Get a real time updates from Firestore DB -> Tracker collection
function monitorTrackers()
{
  //Log data
  logger.debug("Initializing listener on Tracker collection")

  //Initialize listener
  google_services.getDB()
    .collection("Tracker")
    .onSnapshot(querySnapshot => 
    {
      //For each tracker load from snapshot
      querySnapshot.docChanges.forEach(docChange => 
      {
        //Get document id
        var id = docChange.doc.id;

        //Log data
        logger.info("Tracker " + docChange.type + ": " + docChange.doc.get('name'));
    
        //If tracker is inserted or updated
        if(docChange.type === 'added' || docChange.type === 'modified')
        {
          //If this tracker is not currently loaded
          if(!trackers[id])
          {
            //Get tracker model
            switch(docChange.doc.get('model'))
            {
              case 'tk102b': 
                //Create an instance of a TK102B tracker model
                trackers[id] = new TK102B(id, sms_parser, google_services);
                break;

              case 'st940':
                //Create an instance of a ST940 tracker model
                trackers[id] = new ST940(id, tcp_parser, google_services);
                break;

              case 'spot':
                //Create an instance of a SPOT Trace tracker model
                trackers[id] = new SPOT(id, http_parser, google_services);
                break;
            }
          }
    
          //Load data on tracker
          trackers[id].loadData(docChange.doc.data());

          //Check if tracker configuration is loaded
          if(trackers[id].get('lastConfiguration') == null || trackers[id].getConfigurationsCount() == 0)
          {
            //Load configurations from dabatase
            trackers[id].loadConfigFromDB();
          }
        }
        else if(docChange.type === 'removed')
        {
          //Remove tracker from array
          delete trackers[id];
        }
      });
      
    }, err => {
    
      //Log error
      logger.error('Error on tracker snapshot listener', err);

      //Try to start method again
      monitorTrackers();
      
    });
}
