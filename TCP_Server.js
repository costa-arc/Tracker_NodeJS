var EventEmitter = require('events').EventEmitter;

var initialize = function() 
{
    //Initialize controller
    var TCP_Server = new EventEmitter();

    //Create TCP server manger
    TCP_Server.stream = net.createServer();  

    //Define actions on new TCP connection
    TCP_Server.stream.on('connection', conn => 
    {
        //Log connection
        logger.info('TCP (' +  conn.remoteAddress + ") -> Connected");

        //Set enconding
        conn.setEncoding('utf8');

        //On receive data from TCP connection
        conn.on('data', data => {

        //Log data received
        logger.debug("TCP (" + conn.remoteAddress + ') -> [' + data.replace(/\r?\n|\r/, '') + ']');

        //Check if data received is from a ST910/ST940 model
        if(data.startsWith("ST910"))
        {
            //Parse data
            parseST940(data, conn);
        } 
        else
        {
            //Log warning
            logger.warn("TCP data received from unknown tracker model");
        }

        });

        //On TCP connection close
        conn.once('close', function () {
        
        //Log info
        logger.info('TCP (' +  conn.remoteAddress + ") -> Disconnected");
        });

        //On TCP connection error
        conn.on('error', err => {

        //Log error
        logger.error('TCP (' +  conn.remoteAddress + ") -> Error: " + err.message);
        });

    });

    //Start listening on port 5001
    server.listen(5001, function() {  

        //Log info
        logger.info('TCP server listening to port: ' +  server.address().port);
    });
}