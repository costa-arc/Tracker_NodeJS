//Load Google Services data from file
const admin = require("firebase-admin");

//Import logger
const logger = require('./logs/logger');

//Import geocoding services
const node_geocoder = require('node-geocoder')
const geolocation = require('geolocation-360');

//Define methods and properties
class Google_Services
{
  constructor(credentials) 
  {
    //Get firebase credentials
    var serviceAccount = require(credentials);

    //Initialize admin SDK
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://tracker-d3d7e.firebaseio.com"
    });

    //Initialize using google maps static api key
    var geocoder = node_geocoder({
      provider: 'google',
      apiKey: 'AIzaSyAq8QebBfeR7sVRKErHhmysSk5U80Zn3xE', // for Mapquest, OpenCage, Google Premier
    });
    
    //Initialize using two providers (google and openCellId)
    geolocation.initialize({
        googleApiKey: 'AIzaSyBBw803hHB7msBTnZ53YHdDWFPcJACIyCc',
        openCellIdApiKey: '9d604982096e3a'
    });
    
    //Set google services debug function
    admin.firestore.setLogFunction(message => { logger.debug(message); });

    //Load Firebase Firestore DB manager and Cloud Messaging
    this._db = admin.firestore();
    this._fcm = admin.messaging();
    this._admin = admin;

    //Save geolocation and geocoding services
    this._geolocation = geolocation;
    this._geocoder = geocoder;

    //Log data
    logger.info("Google services successfully initialized.")
  }

  //Get Firestore Database
  getDB() {
      return this._db;
  };

  //Get Firebase Cloud Messaging
  getFCM() {
    return this._fcm;
  };

  //Get Firebase Admin service
  getFirestore() {
    return this._admin.firestore;
  };

  //Get Geolocation Services
  getGeolocation() {
      return this._geolocation;
  };

  //Get Geocoding Services
  getGeocoder() {
      return this._geocoder;
  };

  //Send Firebase Cloud Messaging to a specific topic
  sendNotification(tracker_id, topic, params, override)
  {
    // Save tracker ID on param data
    params.id = tracker_id;

    //Used on tracker.insert_coordinates to override default notifications
    if(override)
    {
      //Use override topic
      topic = override.topic;

      //Use override title and content
      params.title = override.title;
      params.content = override.content;

      //If user wants to suppress this notification
      if(override.suppress)
      {
         //Cancel notification by ending this method early
         return;
      }
    }

    // Create topic structure
    topic = (topic.includes("SOS") ? topic: tracker_id + "_" + topic);

    // Send a message to devices subscribed to the provided topic.
    this._fcm.sendToTopic(topic, { data: params }, 
    {
      priority: "high",
      timeToLive: 60 * 60 * 24,
      collapseKey: topic
    })
    .then(function(response) {
      // See the MessagingTopicResponse reference documentation for the
      logger.debug("Successfully sent message to topic " + topic + ":", response);
    })
    .catch(function(error) {
      logger.warn("Error sending message to topic " + topic + ":", error);
    });
  }
}

module.exports = Google_Services