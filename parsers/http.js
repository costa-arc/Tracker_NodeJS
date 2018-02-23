//Imports packages used to parse XML from remote stream
var https = require('https');
var parser = require('xml2js');
var concat = require('concat-stream');

//Import date time parser
const moment = require('moment');

//Import logger
const logger = require('../logs/logger');

//Define methods and properties
class HTTP_Parser
{
   constructor (server_name, tracker_array)
   {
      //Save tracker name
      this._server_name = server_name;

      //Initialize tracker list
      this._trackers = tracker_array;

      //Initialize an periodic check for modem status (every 1 minute)
      setInterval(this.periodicCheck.bind(this), 60000, this._trackers);

      //Log data
      logger.debug("HTTP parser successfully initialialized.")
   }

   periodicCheck(trackers)
   {
      //For each tracker associated with this parser
      for(var id in trackers)
      {
         //If this is a SPOT model tracker
         if(trackers[id].get('model') === 'spot')
         {
            //Call method to check for updates
            this.checkSPOT(trackers[id]);
         }
      }
   }

   checkSPOT(tracker)
   {
      //Initialize request start date variable
      var request = 'https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/' + tracker.get('identification') + '/message.xml';

      //Check if tracker have previous coordinate available
      if(tracker.get('lastCoordinate'))
      {
         //Request coordinates only after this moment
         request += "?startDate=" + moment(tracker.get('lastCoordinate').datetime).add(1, 'minute').format('YYYY-MM-DDTHH:mm:ss-SSSS');//2018-02-03T00:00:00-0000"
      }

      //Check if tracker is not currently being updated
      if(!tracker.updateInProgress)
      {
         //Flag update progress
         tracker.updateInProgress = true;

         //Perform request on SPOT TRACE shared data
         https.get(request, function(resp) 
         {
            //On request error
            resp.on('error', function(err) 
            {
               //Log error
               logger.error("Failed to request spot trace XML feed: " + err);
               
               //Inform error to tracker
               tracker.configError();
            });

            //Concatenate request data
            resp.pipe(concat(function(buffer) 
            {
               //Parse resulting buffer
               parser.parseString(buffer.toString(), function(err, result) 
               {
                  if(err)
                  {
                     //Log error
                     logger.error("Error parsing XML response from tracker " + tracker.name + ": " + err);

                     //Inform error to tracker
                     tracker.configError();
                  }
                  else 
                  {
                     try 
                     {
                        //Get how many results returned from query
                        var total_results = result.response.feedMessageResponse[0].messages[0].message.length;

                        //Check if any result available
                        if(total_results > 0)
                        {
                           //Finished parsing data
                           logger.info("Data available from tracker SPOT@" + tracker.get('name') + " XML feed");

                           //For each result in feed
                           result.response.feedMessageResponse[0].messages[0].message.reverse().forEach(function(message,index) 
                           {
                              //Parse data from message
                              tracker.parseData(message, index, result.response.feedMessageResponse[0].messages[0].message.length);
                           });

                           //Remove flag after estimated process time
                           setTimeout(() => { tracker.updateInProgress = false;}, total_results*1500);
                        }
                        else
                        {
                           //Flag indicating update operation finished
                           tracker.updateInProgress = false;
                        }
                     } 
                     catch (error) 
                     {
                        //Log error
                        logger.error("Unexpected response in XML feed from " + tracker.name + ": " + error, result);

                        //Inform error to tracker
                        tracker.configError();
                     }
                  }
               });
            }));
         });
      }
   }
}

module.exports = HTTP_Parser