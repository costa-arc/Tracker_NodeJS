//Imports package used to create a TCP server
var net = require('net');

//Import logger
const logger = require('../logs/logger');

//Import event emiter class
const EventEmitter = require('events');

//Define methods and properties
class TCP_Parser extends EventEmitter
{
    constructor (server_name, tcp_port)
    {
        //Call parent constructor
        super();

        //Initialize server
        this._server = net.createServer();
        this._server_name = server_name;
        this._connections = {};
        this._tcp_port = tcp_port;

        //Initialize server
        this.initialize();
    }

    initialize()
    {
        //Define actions on new TCP connection
        this._server.on('connection', conn => 
        {
            //Log connection
            logger.info('TCP (' +  conn.remoteAddress + ") -> Connected");

            //Set enconding
            conn.setEncoding('utf8');

            //On receive data from TCP connection
            conn.on('data', data => 
            {
                //Log data received
                logger.debug("TCP (" + conn.remoteAddress + ') -> [' + data.replace(/\r?\n|\r/, '') + ']');

                //Split data using ';' separator
                var content = data.split(';');

                //Check if data received is from a ST910/ST940 model
                if(content[2])
                {
                    //Call method to handle tcp data
                    this.emit('data', conn,
                    { 
                        source: content[2], 
                        content: content
                    });
                }
                else if(data.length > 5)
                {
                    //Log warning
                    logger.warn("Unknown data structure received from TCP connection");
                }

            });

            //On TCP connection close
            conn.on('close', function () {
            
                //Log info
                logger.info('TCP (' +  conn.remoteAddress + ") -> Disconnected");
            });

            //On TCP connection error
            conn.on('error', err => {

                //Log error
                logger.error('TCP (' +  conn.remoteAddress + ") -> Error: " + err.message);
            });
        });

        //Start listening for TCP connections
        this._server.listen(this._tcp_port, () => {  

            //Log info
            logger.info('TCP server listening to port: ' +  this._tcp_port);
        });
    }
    
}

module.exports = TCP_Parser