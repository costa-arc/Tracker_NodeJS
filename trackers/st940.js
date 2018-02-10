//Import logger module
const logger = require('../logs/logger');

//Import base tracker class
const Tracker = require('./tracker');

//Import date time parser
const moment = require('moment');

//Extends base tracker class
class ST940 extends Tracker
{
    constructor(id, tcp_parser, google_services) 
    {
        //Call parent constructor
        super(id, tcp_parser, google_services)
    }

    //Save tcp socket while connection is open
    setConnection(socket)
    {
        this._socket = socket;
    }

    //Return current tcp connection to tracker
    getConnection()
    {
        return this._socket;
    }

    checkConfigurations()
    {
        
    }

    applyConfigurations()
    {
        
    }

    parseData(data)
    {
        //"ST910;Emergency;696478;500;20180201;12:26:55;-23.076226;-054.206427;000.367;000.00;1;4.1;0;1;02;1865;c57704f358;724;18;-397;1267;255;3;25\r"
        if(data[0] === "ST910" && (data[1] === 'Emergency' || data[1] === 'Alert' || data[1] === 'Location'))
        {
            //Parse datetime
            var datetime =  moment.utc(data[4] + "-" + data[5], "YYYYMMDD-hh;mm;ss").toDate();

            //Parse coordinate
            var coordinates = this.getGeoPoint(parseFloat(data[6]), parseFloat(data[7]));

            //Parse speed
            var speed = data[8];

            //Battery level
            var batteryLevel = ((parseFloat(data[11]) - 2.8) * 71).toFixed(0) + '%';

            //Define tracker params to be updated
            var tracker_params = 
            {
                batteryLevel: batteryLevel,
                signalLevel: 'N/D',
                lastCoordinate: 
                {
                    type: "GSM",
                    location: coordinates,
                    datetime: datetime
                }
            };

            //Define coordinates params to be inserted/updated
            var coordinate_params = 
            {
                datetime: datetime,
                signalLevel: 'N/D',
                batteryLevel: batteryLevel,
                position: coordinates,
                speed: speed
            }

            //Insert coordinates on DB
            this.insert_coordinates(tracker_params, coordinate_params);
            
            //If emergency message type
            if(data[1] === 'Emergency')
            {
                //Send ACK command to tracker
                this.sendACK();
            }
        }
        else if(data[1] === 'Alive')
        {
            //Log connection alive
            logger.info("Tracker ST940@" + this.getID() + " connected.");
        }
        else if(data[1] === 'RES')
        {
            //Log commmand response
            logger.info("Tracker ST940@" + this.getID() + " confirmed last command.");
        }
        else
        {
            //Unknown data received
            logger.warn("Unknown data received from tracker " + data.join(';'));
        }
    }

    sendACK()
    {
        //Get tcp connection to tracker if available
        var connectionAvailable = this.getConnection();

        //Check if available
        if(connectionAvailable)
        {
            try
            {
                //Send ACK command to tracker
                connectionAvailable.write('AT^ST910;ACK;' + this.getID());

                //Log data
                logger.debug('TCP (' + connectionAvailable.remoteAddress + ') <- [AT^ST910;ACK;' + this.getID() + "]");
            }
            catch(error)
            {
                //Log error
                logger.error('Error sending ACK to tracker #' + this.getID() + " - Error: " + error);
            }
        }
    }
    
}

module.exports = ST940