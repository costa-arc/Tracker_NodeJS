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

      //Initialize an periodic check for modem status (every 3 minutes)
      setInterval(this.periodicCheck.bind(this), 3*60000, this._trackers);

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
      //Check if tracker is not currently being updated
      if(!tracker.updateInProgress)
      {            
         //Initialize request start date variable
         var request = 'https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/' + tracker.get('identification') + '/message.json';

         //Check if tracker have previous coordinate available
         if(tracker.get('lastCoordinate'))
         {
            //Request coordinates only after this moment
            request += "?startDate=" + moment(tracker.get('lastCoordinate').datetime).utc().add(1, 'second').format('YYYY-MM-DDTHH:mm:ss-0000');//2018-02-03T00:00:00-0000"
         }

         //Perform request on SPOT TRACE shared data
         https.get(request, function(resp) 
         {
            //Concatenate request data
            resp.pipe(concat(buffer =>
            {
               //Flag update progress
               tracker.updateInProgress = true;

               try
               {
                  //Parse response
                  var result = JSON.parse(buffer.toString())

                  //Check if result is an error message
                  if(result.response.errors)
                  {  
                     //Throw error description
                     throw result.response.errors.error.description;
                  }
                  else if(!result.response.feedMessageResponse)
                  {
                     //XML can't be parsed, throw error
                     throw "Unknown XML structure";
                  }
                  else
                  {
                     //Get how many results returned from query
                     var total_results = result.response.feedMessageResponse.totalCount;

                     //Get result list
                     var response = result.response.feedMessageResponse.messages.message;

                     //If single result from query
                     if(total_results == 1)
                     {
                        //Parse single message
                        tracker.parseData(response, 0, total_results);

                        //Finished parsing data
                        logger.info("Data available from tracker SPOT@" + tracker.get('name') + " XML feed");
                     }
                     else
                     {
                        //For each result in feed
                        response.reverse().forEach(function(message,index) 
                        {
                           //Parse data from message
                           tracker.parseData(message, index, total_results);
                        });

                        //Finished parsing data
                        logger.info("Data available (" + total_results + " results) from tracker SPOT@" + tracker.get('name') + " XML feed");
                     }

                     //Remove flag after estimated process time
                     setTimeout(() => { tracker.updateInProgress = false;}, total_results*1500);
                  }
               }
               catch(error)
               {
                   //Flag update finished
                  tracker.updateInProgress = false;
                  
                  //Check if it is an empty result request
                  if(typeof error == 'string' && error.includes('No displayable messages'))
                  {
                     //Log data
                     logger.debug('No updates on tracker SPOT@' + tracker.get('name'));
                  }
                  else
                  {
                     //Log error
                     logger.error("Unexpected response in XML feed from " + tracker.name + ": " + error, result);

                     //Inform error to tracker
                     tracker.configError();
                  }
               }                
            }));
         }).on('error', error =>
         {
            //Log error
            logger.error("HTTP Request error on tracker " + tracker.name + ": " + error);           
         })
      }
   }
}

module.exports = HTTP_Parser