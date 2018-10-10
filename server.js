'use strict';

//Import logger module
const logger = require('./logs/logger');

//Import Google Services (Firebase, geocoding, geolocation)
const Google_Services = require('./google');

//Import local parsers
const HTTP_Module = require('./parsers/http');
const TCP_Module = require('./parsers/tcp');
const SMS_Module = require('./parsers/sms');

//Import tracker models
const TK102B = require('./trackers/tk102b');
const ST940 = require('./trackers/st940');
const SPOT = require('./trackers/spot');

//Import client module
const Client = require("./client")

//Get process params
const tcp_port = 5001;
const com_port = process.argv[2];
const server_name = process.argv[3];

//Initialize Google services 
var google_services = new Google_Services("./credentials.json");

//Flag indicating if google services are properly initialized
var initialized = false;

//Initialize tracker array
var trackers = {};

//Initialize clients array
var clients = {};

//Initialize HTTP Parser
var http_parser = new HTTP_Module(server_name, trackers);

//Initialize TCP Parser
var tcp_parser = new TCP_Module(server_name, tcp_port);

//Initialize SMS Parser
var sms_parser = new SMS_Module(server_name, com_port);

//Handle data comming from 
sms_parser.on('data', (type, data) => 
{
	//Check if tracker monitoring already initialized
	if(initialized)
	{
		//Try to find any tracker (or client) with this phone number
		var tracker = searchByPhoneNumber(data.source);

		//Check the source from data is a known tracker
		if(tracker)
		{
			//Call method to parse data
			tracker.parseData(type, data);
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
			
			//Message already parsed, delete from memmory
			sms_parser.deleteMessage(data.content);
		}
	}
	else
	{
		//Log warning
		logger.warn("SMS from " + data.source + " stored on modem memory before DB initialization");
	}
});

//Handle data comming from 
tcp_parser.on('data', (model, tcp_socket, data) => 
{
  //Check the source from data is a known tracker
  if(trackers[data.source])
  {
		//Add tcp connection to tracker
		trackers[data.source].setConnection(tcp_socket);

		//Call method to parse data
		trackers[data.source].parseData('tcp_data', data.content);
  }
  else if(model == "CLIENT")
  {
		//If client is not connected yet
		if(!clients[data.source])
		{
			//Add new client to list
			clients[data.source] = new Client(data.source, sms_parser);
		}

		//Update tcp_socket from client
		clients[data.source].setConnection(tcp_socket);

		//Call method to parse data
		clients[data.source].parseData('tcp_data', data.content);
  }
  else
  {
		//Check on DB if there is a tracker with this ID
		google_services.getDB()
		.doc("Trackers/" + data.source)
		.get()
		.then(docSnapshot => 
		{
			//if there is no tracker with this ID
			if (!docSnapshot.exists) 
			{
				//If SUNTECH MODEL
				if(model == "ST910" || model == "ST940")
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
						.collection('Trackers')
						.doc(data.source)
						.set(tracker_params, { merge: true })
						.then(() => 
						{          
							//Save current data on tracker (untill loading)
							trackers[data.source].loadData(tracker_params);       

							//Add tcp connection to tracker
							trackers[data.source].setConnection(tcp_socket);

							//Call method to parse data
							trackers[data.source].parseData(data.content);
						});
				}
				else if(model == "TK102B")
				{

				}
				else
				{
					//Log info
					logger.warn("Unknown tracker model: " + model + " / " + data.source)
				}
			}
		});
  	}
});

//Start monitoring trackers
monitorTrackers();

//UncaughtException
process.on('uncaughtException', function (err) {
	logger.error(err);
});

//Get a real time updates from Firestore DB -> Tracker collection
function monitorTrackers()
{
	//Log data
	logger.debug("Initializing listener on Tracker collection")

	//Initialize listener
	google_services.getDB()
		.collection("Trackers")
		.onSnapshot(querySnapshot => 
		{
			//Flag -> Listener initialized
			initialized = true;

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

							case 'tk1102b':
								//Create an instance of a TK1102B tracker model
								trackers[id] = new TK1102B(id, sms_parser, google_services);
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

					//Check if tracker configuration is not loaded, or if it is not configured yet or user canceled configuration
					if(trackers[id].getConfigurationsCount() == 0 ||
						trackers[id].get('lastConfiguration') == null || 
						trackers[id].get('lastConfiguration').step == "CANCELED") {

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
		
			//Flag -> Listener stopped
			initialized = false;

			//Log error
			logger.error('Error on tracker snapshot listener', err);

			//Try to start method again
			monitorTrackers();
		
		});
}

function searchByPhoneNumber(phoneNumber)
{

	for (var client_auth in clients) 
	 {
		 if(clients[client_auth].getPhoneNumber() == phoneNumber)
		 {
			 return clients[client_auth];
		 }
	}

	for (var tracker_id in trackers) 
	{
		if(trackers[tracker_id].get('identification') == phoneNumber)
		{
			return trackers[tracker_id];
		}
  }
}
