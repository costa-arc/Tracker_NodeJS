var SerialPort = require('serialport');
var i = 0;
var port = new SerialPort('COM23', {
	echo: false,
	baudRate: 115200
});

port.pipe(new SerialPort.parsers.Readline({delimeter: '\r\n'}));

port.on('error', function(error) 
{
	console.log(error);
});

port.on('open', function() 
{                         
  //Bind data received
  port.on('data',  (data) => {
	  i+= data.toString().trim().length;
	  console.log("Modem -> [" + data.toString().trim() + "] / Memmory Usage -> "); 
	  console.log(process.memoryUsage())
	  console.log("Length: " + i);
	  port.resume();
	});

	setInterval(function() {
		port.write("AT+CLCK=?\r");
	}, 25, this);
});

var stdin = process.openStdin();

stdin.addListener("data", function(data) {
	console.log("Modem <- [" + data.toString().trim() + "] / Memmory Usage -> " + process.memoryUsage().rss); 
	port.write(data.toString());
});

port.on('close', function() 
{
	console.log("closed");
});