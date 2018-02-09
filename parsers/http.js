//Imports packages used to parse XML from remote stream
var https = require('https');
var parser = require('xml2js');
var concat = require('concat-stream');

//Import logger
const logger = require('../logs/logger');

//Initialize google variable
var method = HTTP_Parser.prototype;

//Define methods and properties
function HTTP_Parser()
{
  //Initialize XML responses array
  this._xmlResponses = [];

  //Log info
  logger.info("HTTP Parser successfully initialized");
}

method.updateSPOT = function(tracker_id, tracker)
{
  //Perform request on SPOT TRACE shared data
  https.get('https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/' + tracker.identification + '/message.xml', function(resp) {
  
    //On request error
    resp.on('error', function(err) 
    {
      //Log error
      logger.error("Failed to request spot trace XML feed: " + err);
    });

    //Concatenate request data
    resp.pipe(concat(function(buffer) {
      
      //Parse resulting buffer
      parser.parseString(buffer.toString(), function(err, result) 
      {
        if(err)
        {
          //Log error
          logger.error("Error parsing XML response from tracker " + tracker.name + ": " + err);
        }
        else 
        {
          try 
          {
            //For each result in feed
            result.response.feedMessageResponse[0].messages[0].message.reverse().forEach(function(message,index) 
            {
              //Check if this was not parsed before
              if(!xmlResponses.includes(message["id"][0]))
              {
                //Check if this coordinate exists on DB
                db.doc("Tracker/" + tracker_id + "/Coordinates/" + message["id"][0])
                  .get()
                  .then(docSnapshot => 
                  {
                    //if not added yet
                    if (!docSnapshot.exists) 
                    {
                      //Create coordinate object
                      coordinates = new admin.firestore.GeoPoint(parseFloat(message['latitude'][0]), parseFloat(message['longitude'][0]));

                      //Parse datetime
                      datetime = moment.utc(message['dateTime'][0], "YYYY-MM-DDThh:mm:ss").toDate();

                      //Parse speed
                      speed = (message['messageType'][0] === ("NEWMOVEMENT") ? 30 : 0);

                      //Parse battery level
                      batteryLevel = (message["batteryState"][0] === "GOOD" ? 80 : 30);

                      //Define tracker params to be updated
                      tracker_params = 
                      {
                        batteryLevel: batteryLevel,
                        signalLevel: 100,
                        lastCheck: new Date(),
                        lastCoordinateType: "GPS",
                        lastCoordinate: coordinates,
                        lastUpdate: datetime
                      };

                      //Define coordinates params to be inserted/updated
                      coordinate_params = 
                      {
                        id: message["id"][0],
                        datetime: datetime,
                        signalLevel: 100,
                        batteryLevel: batteryLevel,
                        position: coordinates,
                        speed: speed
                      }

                      //Insert coordinates
                      setTimeout(function() { insert_coordinates(tracker_id, tracker_params, coordinate_params) }, index*1000);

                      //Save on parsed xml responses
                      xmlResponses.push(message["id"][0]);
                    }
                  });
              }
            });

            //On success, update last check on tracker
            updateLastCheck(tracker_id, tracker, new Date());

            //Finished parsing data
            logger.info("Successfully parsed tracker " + tracker.name + " XML feed");
          } 
          catch (error) 
          {
            //Log error
            logger.error("Unexpected response in XML feed from " + tracker.name + ": " + error, result);
          }
        }
      });
    }));
  });
}

module.exports = HTTP_Parser