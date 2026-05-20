import * as net from 'net';

const client = net.createConnection({ port: 9000 }, () => {
    console.log('Connected to GPS Gateway to send Corrupted Concox frame');

    // Send a login packet with an invalid/manipulated CRC checksum (0x0000 instead of 0x2A14)
    const corruptLoginPacket = Buffer.from([
        0x78, 0x78,             // Start flag
        0x0D,                   // Length 
        0x01,                   // Protocol (Login)
        0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, // IMEI BCD
        0x00, 0x01,             // Serial Number
        0x00, 0x00,             // Corrupt CRC16 (expected 0x2A14)
        0x0D, 0x0A              // End Flag
    ]);

    console.log('Sending Corrupted Concox Login Payload...');
    client.write(corruptLoginPacket);
});

client.on('data', (data) => {
    console.log('Received response (should not get ACK if dropped):', data.toString('hex'));
    client.end();
});

client.on('end', () => {
    console.log('Connection closed by server as expected.');
});
