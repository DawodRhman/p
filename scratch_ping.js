const net = require('net');

const client = new net.Socket();

client.connect(9000, '119.30.113.21', () => {
    console.log('Connected to Ubuntu Server! Sending Teltonika Login...');
    
    const imei = '352093085934940';
    const loginBuf = Buffer.alloc(2 + imei.length);
    loginBuf.writeUInt16BE(imei.length, 0);
    loginBuf.write(imei, 2);
    
    client.write(loginBuf);
});

client.on('data', (data) => {
    console.log('Received from server:', data.toString('hex'));
    if (data.toString('hex') === '01') {
        console.log('Server accepted login! Sending fake GPS data...');
        
        // This is a valid, raw Teltonika Codec 8 payload (1 record)
        const fakeDataHex = '000000000000002d8e0801000001804f3231e8000f07bf014e7a8e0032005a0104000000000101010101000000000100000000';
        client.write(Buffer.from(fakeDataHex, 'hex'));
    } else {
        console.log('Server ACKed the GPS data! Everything is working!');
        client.destroy();
    }
});

client.on('error', (err) => {
    console.error('Connection error:', err);
});
