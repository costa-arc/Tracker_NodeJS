//Import GSM modem package
var modem = require('modem').Modem()

//Import log manager
var winston = require('winston');

//Imports packages used to parse XML from remote stream
var https = require('https');
var parser = require('xml2js');
var concat = require('concat-stream');

//Imports package used to create a TCP server
var net = require('net');
var readline = require('readline');
var lastConn = null;

//Used to reverse geocode latitude to address
var NodeGeocoder = require('node-geocoder')

//Used to search GSM tower cell geolocation
var geolocation = require('geolocation-360');

//Load task scheduler
var cron = require('node-cron');

//Load service account from local JSON file
const serviceAccount = require("./firebaseAdmin.json");

//Import firebase admin SDK
const admin = require("firebase-admin");

//Initialize using google maps static api key
var geocoder = NodeGeocoder({
  provider: 'google',
  apiKey: 'AIzaSyAq8QebBfeR7sVRKErHhmysSk5U80Zn3xE', // for Mapquest, OpenCage, Google Premier
});

//Initialize using two providers (google and openCellId)
geolocation.initialize({
	googleApiKey: 'AIzaSyBBw803hHB7msBTnZ53YHdDWFPcJACIyCc',
	openCellIdApiKey: '9d604982096e3a'
});

//Initialize admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://tracker-d3d7e.firebaseio.com"
});

//Load Firebase Firestore DB manager and Cloud Messaging
db = admin.firestore();
fcm = admin.messaging();

//Schedule periodic check (every minute)
cron.schedule('* * * * *', system_check);

//Initialize tracker array
var trackers = {};

//Initialize SMS array
var sms_sent = {};

//Initialize logger
var logger = initializeLog();

//Log initalization
logger.info('Application initialized, dependencies loaded successfully');

//Initialize TCP Server
initializeTCPServer();

//Initialize modem
initializeModem();

//Start monitoring trackers
monitorTrackers();

function system_check() 
{
  //Log data
  logger.debug('Running periodic check');

  //Check modem status
  if(modem != null && modem.isOpened)
  {
    //Execute check on modem (AT -> must return 'OK')
    modem.execute("AT", function (escape_char, response) 
    {
      //Check response
      if(response != "OK")
      {
        //Log error
        logger.error("Error on scheduled modem check: " + response);

        //Try to close modem connection
        modem.close();
      }
    });
  }
  else
  {
    //Log warning
    logger.warn("Periodic check: Modem not working properly")
  }

  //Perform check on trackers
  for(var id in trackers)
  {
    //Perform periodic check on tracker
    checkTracker(id, trackers[id])
  }
}

function initializeLog()
{
  //Define application log format
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(function (info) {
      const { timestamp, level, message, ...args} = info;

      return `${info.timestamp} - ${info.level}: ${info.message} ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ''}`;
    })
  );

  //Create application logger
  return winston.createLogger({
    transports: 
    [
      new winston.transports.Console({ 
        format: winston.format.combine(winston.format.colorize(), logFormat),
        handleExceptions: true
      }), 
      new winston.transports.File({ 
        filename: 'logs/tracker_warning.log', 
        level: 'warning', 
        format: logFormat,
        maxsize: 5000000, 
        maxfiles: 10 }),
      new winston.transports.File({ 
        filename: 'logs/tracker_info.log', 
        level: 'info', 
        format: logFormat,
        maxsize: 5000000, 
        maxfiles:10 }),
      new winston.transports.File({ 
        filename: 'logs/tracker_debug.log', 
        format: logFormat,
        maxsize: 1000000, 
        maxfiles: 20 })
    ],
    exceptionHandlers: [
        new winston.transports.File({filename: 'logs/exceptions.log'})
    ], 
    exitOnError: false,
    level: 'debug'
  });
}

function initializeModem()
{
  //Error handling'
  modem.on("error", error =>
  {
    //Log error
    logger.error("Connection to modem failed: " + error);

    //Close connection to modem
    modem.close();

  });

  //Open connection on modem serial port
  modem.open(process.argv[2], result =>
  {
    //On command sent to modem
    modem.on('command', function(command) {

      //Log command
      logger.debug("Modem <- [" + command + "]");
    });

    //Execute modem configuration (RESET MODEM)
    modem.execute("ATZ");

    //Execute modem configuration (DISABLE ECHO)
    modem.execute("ATE0");

    //Execute modem configuration (ENABLE TX/RX)
    modem.execute("AT+CFUN=1");

    //Execute modem configuration (SET PDU MODE)
    modem.execute("AT+CMGF=0");

    //Execute modem configuration (ENABLE ERROR MESSAGES)
    modem.execute("AT+CMEE=2");

    //Execute modem configuration (REQUEST DELIVERY REPORT)
    modem.execute("AT+CSMP=49,167,0,0");

    //Execute modem command (REQUEST MANUFACTURER)
    modem.execute("AT+CGMI", function(response)
    {
      //If this is a HUAWEI MODEM
      if(response.includes('huawei'))
      {
        //Execute modem configuration (REQUEST SMS NOTIFICATION - HUAWEI)
        modem.execute("AT+CNMI=2,1,0,2,0");
      }
      else
      {
        //Execute modem configuration (REQUEST SMS NOTIFICATION - DLINK)
        modem.execute("AT+CNMI=2,1,0,1,0");
      }
    });

    //On SMS received
    modem.on('sms received', function(sms) 
    {
      //Call method to handle sms
      handleSMSReceived(sms);

    });

    //On data received from modem
    modem.on('data', function(data) {

      //Log any data ouput from modem
      logger.debug("Modem -> [" + data.join().replace(/(\r\n|\n|\r)/gm,"") + "]");
    });
    
    //On SMS delivery receipt received
    modem.on('delivery', function(delivery_report) 
    {
      //Call mehtod to handle delivery report
      handleDeliveryReport(delivery_report);
    });

    //On modem memmory full
    modem.on('memory full', function(sms) 
    {
      //Execute modem command (DELETE ALL MESSAGES)
      modem.execute("AT+CMGD=1,4", function(escape_char, response) 
      {
        //Log data
        logger.info("Modem memory full, erasing SMS: " + response)
      });
    });

    //On modem connection closed
     modem.on('close', function() 
     {
      //Log warning 
      logger.debug("Modem connection closed, trying to open again...");

      //Initialize modem again in 5 seconds
      setTimeout(initializeModem, 5000);
     });
  });
}

function initializeTCPServer()
{
  var server = net.createServer();  
  server.on('connection', handleConnection);

  server.listen(5001, function() {  
    logger.info('TCP server listening to port: ' +  server.address().port);
  });

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', function(line){
    lastConn.write(line);
    logger.debug("TCP (" + lastConn.remoteAddress + ") <- [" + line + "]")
  })
}

function handleConnection(conn) 
{  
  logger.info('TCP (' +  conn.remoteAddress + ") -> Connected");

  conn.setEncoding('utf8');
  conn.on('data', onConnData);
  conn.once('close', onConnClose);
  conn.on('error', onConnError);

  lastConn = conn;

  function onConnData(d) {
    logger.debug("TCP (" + conn.remoteAddress + ') -> [' + d.replace(/\r?\n|\r/, '') + ']');
  }

  function onConnClose() {
    logger.info('TCP (' +  conn.remoteAddress + ") -> Disconnected");
  }

  function onConnError(err) {
    logger.error('TCP (' +  conn.remoteAddress + ") -> Error: " + err.message);
  }
}

function handleSMSReceived(sms)
{
  //Log output
  logger.debug("SMS RECEIVED", sms);

  //Search tracker using sms phone number
  var tracker_id = searchTracker(sms.sender);

  //If tracker available
  if(tracker_id)
  {
    //If it is a delivery confirmation 
    if(sms.text.indexOf('entregue') > 0)
    {
      //Just log data (delivery report is handled it's own method)
      logger.debug('Received SMS delivery report from ' + trackers[tracker_id].name);
      
      //Message not relevant, delete from memmory
      modem.deleteMessage(sms);
    }
    else
    {
      //Save message on firestore DB
      db.collection("Tracker/" + tracker_id + "/SMS_Received").add({
        receivedTime: sms.time,
        text: sms.text.replace(/\0/g, '')
      }).then(() => 
      {
        // Message already saved on DB, delete from modem memmory
        modem.deleteMessage(sms);
      });;;

      //Send notification to users subscribed on this topic
      sendNotification(tracker_id, "NotifySMSResponse", {
        title: "Recebimento de SMS",
        content: "SMS enviado pelo rastreador foi recebido.",
        expanded: "SMS enviado pelo rastreador foi recebido: \n\n" + sms.text.replace(/\0/g, ''),
        datetime: sms.time.getTime().toString()
      });

      //Check tracker model 
      if(trackers[tracker_id].model === "TK 102B")
      {
        //parse message
        parseTK102B(tracker_id, sms);
      }
      else 
      {
        //Log warning
        logger.warn("Failed to parse message from tracker " + tracker + ": Unknown model");

        //Message already parsed, delete from memmory
        modem.deleteMessage(sms);
      }
    }
  }
  else
  {
    //Log warning
    logger.warn("Received SMS from unknown number");

    //Save on firestore DB global SMS Received collection
    db.collection("SMS_Received").add({
      from: sms.sender,
      receivedTime: sms.time,
      text: sms.text.replace(/\0/g, '')
    });
    
    //Message already parsed, delete from memmory
    modem.deleteMessage(sms);
  }
}

function handleDeliveryReport(delivery_report)
{
  //Log delivery receipt
  logger.info("DELIVERY RECEIPT RECEIVED", delivery_report)

  //Initialize notification params
  notificationParams = { datetime: Date.now().toString() }

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
  sms = sms_sent[delivery_report.reference]

  //If sms_sent is available
  if(sms)
  {
    //Get tracker ID
    tracker_id = sms.tracker_id;

    //Append SMS text on notification
    notificationParams.expanded = "Confirmou o recebimento do SMS: " + sms.text;

    //Update data on firestore DB
    db.doc('Tracker/' + tracker_id + '/SMS_Sent/' + sms.id).update({
      receivedTime: new Date(),
      status: 'DELIVERED'
    });
  } 
  else
  {
    //Try to get tracker ID from 
    tracker_id = searchTracker(delivery_report.sender);
  }

  //If tracker ID is available
  if(tracker_id)
  {
    //Send notification
    sendNotification(tracker_id, "NotifyAvailable", notificationParams);

    //Log data
    logger.info("Received delivery report from " + trackers[tracker_id].name);
  }
  else
  {
    //Log warning
    logger.warn("Received delivery report from unknown number: " + delivery_report.sender);
  }
}

function sendNotification(tracker_id, topic, params)
{
  // Save tracker ID on param data
  params.id = tracker_id;

  // Create topic structure
  topic = tracker_id + "_" + topic;

  // Send a message to devices subscribed to the provided topic.
  fcm.sendToTopic(topic, { data: params }, 
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

//Get a real time updates from Firestore DB -> Tracker collection
function monitorTrackers()
{
  //Log data
  logger.debug("Initializing listener on Tracker collection")

  //Initialize listener
  db.collection("Tracker").onSnapshot(querySnapshot => 
    {
      //For each tracker load from snapshot
      querySnapshot.docChanges.forEach(docChange => 
      {
        //Log data
        logger.info("Tracker " + docChange.type + ": " + docChange.doc.get('name'));
    
        //If tracker is inserted or updated
        if(docChange.type === 'added' || docChange.type === 'modified')
        {
          //Save tracker on array
          trackers[docChange.doc.id] = docChange.doc.data();
    
          //Initialize update counter
          trackers[docChange.doc.id].updateAttempts = 0;
    
          //Perform initial check on tracker
          checkTracker(docChange.doc.id, trackers[docChange.doc.id]);
        } 
        else if(docChange.type === 'removed')
        {
          //Remove tracker from array
          delete trackers[docChange.doc.id];
        }
      });
      
    }, err => {
    
      //Log error
      logger.error('Error on tracker snapshot listener', err);

      //Try to start method again
      monitorTrackers();
      
    });
}

function checkTracker(id, tracker)
{
  //Get current datetime
  const currentDate = new Date();

  //Check if need to run check on tracker now
  if(tracker.lastCheck == null || (currentDate - tracker.lastCheck) / 1000 > tracker.updateInterval * 60)
  {
    //Check tracker already tried to update more than 3 times
    if(tracker.updateAttempts >= 3)
    {
      //In this case, consider update failed (stop trying to update)
      updateLastCheck(id, tracker, currentDate);

      //Log error
      logger.error("Update on tracker " + tracker.name + " failed");
    }
    else
    {
      //If this is the first attempt to update tracker
      if(tracker.updateAttempts == 0)
      {
        //Log as debug
        logger.debug('Performing check on tracker: ' + tracker.name);
      }
      else
      {
        //Log as warning (first try failed)
        logger.warn('Performing check on tracker: ' + tracker.name + " (" + (tracker.updateAttempts + 1) + " attempt)");
      }

      //Increase atempts counter
      tracker.updateAttempts++;

      //Check tracker model
      if(tracker.model === "TK 102B")
      {
        //Perform check on TK102B model tracker
        updateTK102B(id, tracker, currentDate);
      }
      else if(tracker.model === "SPOT")
      {
        //Perform check on TK102B model tracker
        updateSPOT(id, tracker);
      }
      else
      {
        //Log warning
        logger.warn("Update requested on unknown traker model: " + tracker.model);

        //Update last check (no updates performed)
        updateLastCheck(id, tracker, currentDate);
      }
    }
  } 
  else
  {
    //Log data
    logger.debug('Next check on tracker ' + tracker.name + ' in ' + Math.round(tracker.updateInterval * 60 - (currentDate - tracker.lastCheck) / 1000) + ' seconds');
  }    
}

function updateTK102B(id, tracker, currentDate)
{
  //Send SMS to request position and define callback
  send_sms(id, tracker, 'smslink123456', function() {

    //On success, update last check on tracker
    updateLastCheck(id, tracker, currentDate)

    //Log data
    logger.info("Update on tracker " + tracker.name + " successfully finished.")
  });

  //Send SMS to request status (no callback required)
  send_sms(id, tracker, 'check123456');
}

function send_sms(id, tracker, command, callback)
{
  //Send command to request current position
  modem.sms({
    receiver: tracker.identification,
    text: command,
    encoding:'16bit'
  }, 
  function(result, message_id) 
  {
    //if any error ocurred
    if(result == "SENT")
    {
      //Save SMS sent on firestore DB
      db.collection("Tracker/" + id + "/SMS_Sent").add({
        text: command,
        reference: message_id,
        sentTime: new Date(),
        receivedTime: null,
        status: 'ENROUTE'
      })
      .then(function(docRef) 
      {
        //Log data
        logger.debug("SMS command [" + command + "] sent to tracker " + tracker.name + ": Reference: #" + message_id + " -> Firestore ID: " +  docRef.id);

        //Save on sms_sent array
        sms_sent[message_id] = { 
          text: command, 
          id: docRef.id,
          tracker_id: id
        };
      })
      .catch(function(error) 
      {
        //Log warning
        logger.warn("SMS command [" + command + "] sent to tracker " + tracker.name + ": Reference: #" + message_id + " -> Could not save on firestore: " + error);
      });

      //Invoke callback if provided
      if(callback)
        callback();
    }
    else
    {
      //Log error
      logger.warn('Error sending sms to tracker ' + tracker.name + ': ' + result);
    }
  });
}

function updateSPOT(tracker_id, tracker)
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
            result.response.feedMessageResponse[0].messages[0].message.forEach(message => 
            {
              //console.log(message);
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

function parseTK102B(tracker_id, sms) 
{
  //Remove null bytes from string
  sms_text = sms.text.replace(/\0/g, '')

  //Check if received just confirmation to SMS delivery
  if(sms_text.startsWith('GSM: '))
  {
    //Get signal level from SMS text
    index = sms_text.indexOf('GSM: ') + 'GSM: '.length;
    signal_level = parseInt(sms_text.substring(index, sms_text.substring(index).indexOf('%') + index));

    //Get battery level from SMS text
    index = sms_text.indexOf('BATTERY: ') + 'BATTERY: '.length;
    battery_level = parseInt(sms_text.substring(index, sms_text.substring(index).indexOf('%') + index));

    //Update value on firestore DB
    db.doc("Tracker/" + tracker_id).update({
      signalLevel: signal_level,
      batteryLevel: battery_level
    })

    //Send notification to users subscribed on this topic
    sendNotification(tracker_id, "NotifyStatus", {
      title: "Atualização de status",
      content: "Bateria: " + battery_level + "% / Sinal GSM: " + signal_level + "%",
      datetime: sms.time.getTime().toString()
    });
    
    //Log info
    logger.info('Successfully parsed status message from: ' + trackers[tracker_id].name);
  } 
  else if(sms_text.indexOf('lac') >= 0 && sms_text.indexOf('mnc') >= 0)
  {
    //Initialize request params array
    requestParams = {};

    //Get LAC from SMS text
    index = sms_text.indexOf('lac');
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
    geolocation.request(requestParams, (error, result) => 
    {  
      //If result is successfull
      if (result && result.latitude < 90 && result.longitude < 90) 
      {
        //Create coordinates object
        var coordinates = new admin.firestore.GeoPoint(result.latitude, result.longitude);

        //Geocode address and save coordinate
        insert_coordinates(tracker_id, 'GSM', coordinates, 0);
      } 
      else 
      {
        //Log error
        logger.error("Failed to geolocate data from GSM cell tower", requestParams);
      }
    });
  }
  else if(sms_text.startsWith('lat'))
  {
    //Get latitude from SMS text
    index = sms_text.indexOf('lat:') + 'lat:'.length;
    latitude = sms_text.substring(index, sms_text.substring(index).indexOf(' ') + index);

    //Get longitude from SMS text
    index = sms_text.indexOf('long:') + 'long:'.length;
    longitude = sms_text.substring(index, sms_text.substring(index).indexOf(' ') + index);

    //Get speed from SMS text
    index = sms_text.indexOf('speed:') + 'speed:'.length;
    speed = sms_text.substring(index, sms_text.substring(index).indexOf(' ') + index);

    //Create coordinates object
    var coordinates = new admin.firestore.GeoPoint(parseFloat(latitude), parseFloat(longitude));

    //Geocode address and save coordinate
    insert_coordinates(tracker_id, 'GPS', coordinates, speed);
  } 
  else
  {
    //Log warning
    logger.warn('Unable to parse message from TK102B model: ' + sms_text);
  }
}


function updateLastCheck(id, tracker, currentDate)
{
  //Run check on tracker right now
  var tracker_reference = db.collection('Tracker').doc(id);

  //Update tracker lastcheck
  tracker_reference.update('lastCheck', currentDate);

  //Change value locally (offline persistence, avoid multiple updates if no internet connection)
  tracker.lastCheck = currentDate;
  
  //Clear update attempts counter
  tracker.updateAttempts = 0;
}

function searchTracker(phoneNumber)
{
  //For each tracker loaded in application
  for(var id in trackers)
  {
    //Check if identification equals phone number
    if(trackers[id].identification === phoneNumber.replace('+','').replace('55', ''))
    {
      //return tracker id
      return id;
    }
  }

  //Tracker not found, return null
  return null;
}

//Return the distance in meters between to coordinates
function distance(coordinates1, coordinates2) {
  
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

function insert_coordinates(tracker_id, coordinates_type, coordinates, speed)
{
  //Update tracker
  db.doc('Tracker/' + tracker_id).update({
    lastCoordinateType: coordinates_type,
    lastCoordinate: coordinates,
    lastUpdate: new Date()
  });

  //Get latest coordinate
  db.collection('Tracker/' + tracker_id + '/Coordinates')
    .orderBy('datetime', 'desc')
    .limit(1)
    .get()
    .then(function(querySnapshot) 
    {
      //Get result from query
      lastCoordinate = querySnapshot.docs[0];

      //If no coordinates available or the distance is less than 50 meters from current position
      if(lastCoordinate == null || distance(coordinates, lastCoordinate.data().position) > 50)
      {
        //Log data
        logger.debug("Requesting reverse geocoding", coordinates);

        //Geocode address
        geocoder.reverse({
          lat: coordinates.latitude, 
          lon: coordinates.longitude
        })
        .then(function(res) 
        {
          //Insert coordinates with geocoded address
          db.collection('Tracker/' + tracker_id + "/Coordinates").add({
            cellID: (coordinates_type == 'GSM' ? 'GSM' : null),
            address: res[0].formattedAddress,
            datetime: new Date(),
            position: coordinates,
            signalLevel: trackers[tracker_id].signalLevel,
            batteryLevel: trackers[tracker_id].batteryLevel,
            speed: parseFloat(speed)
          })

          //Send notification to users subscribed on this topic
          sendNotification(tracker_id, "NotifyMovement", {
            title: "Alerta de movimentação",
            content: res[0].formattedAddress,
            coordinates: coordinates.latitude + "," + coordinates.longitude,
            datetime: Date.now().toString()
          });

          //Log info
          logger.info('Successfully parsed ' + coordinates_type + ' location message from: ' + trackers[tracker_id].name + " - Coordinate inserted");
        })
        .catch(function(err) 
        {  
          //Insert coordinates without geocoded address
          db.collection('Tracker/' + tracker_id + "/Coordinates").add({
            cellID: (coordinates_type == 'GSM' ? 'GSM' : null),
            address: "Localização aproximada não disponível.",
            datetime: new Date(),
            position: coordinates,
            signalLevel: trackers[tracker_id].signalLevel,
            batteryLevel: trackers[tracker_id].batteryLevel,
            speed: parseFloat(speed)
          })

          //Send notification to users subscribed on this topic
          sendNotification(tracker_id, "NotifyMovement", {
            title: "Alerta de movimentação",
            content: "Coordenadas: " + coordinates.latitude + "," + coordinates.longitude,
            coordinates: coordinates.latitude + "," + coordinates.longitude,
            datetime: Date.now().toString()
          });

          //Log warning
          logger.warn('Parsed ' + type + ' location message from: ' + trackers[tracker_id].name + " - Geocoding failed: " + err);
        }); 
      }
      else
      {
        //Current coordinates is too close from previous, just update last coordinate
        db.doc('Tracker/' + tracker_id + "/Coordinates/" + lastCoordinate.id).update({
          lastDatetime: new Date(),
          position: coordinates
        })

        //Send notification to users subscribed on this topic
        sendNotification(tracker_id, "NotifyStopped", {
          title: "Alerta de permanência",
          content: "Rastreador permanece na mesma posição.",
          coordinates: coordinates.latitude + "," + coordinates.longitude,
          datetime: Date.now().toString()
        });
        
        //Log info
        logger.info('Successfully parsed ' + coordinates_type + ' location message from: ' + trackers[tracker_id].name + " - Coordinate updated");
      }

    }).catch(function(error) {
        console.log("Error getting document:", error);
    });
}