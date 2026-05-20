import * as net from 'net';

const client = net.createConnection({ port: 9000 }, () => {
    console.log('Connected to GPS Gateway as a Concox Device');

    // 1. Send Login Packet (IMEI: 0123456789ABCDEF, Serial: 0001)
    // Structured with exact matching valid CRC: 0xF42E
    const loginPacket = Buffer.from([
        0x78, 0x78,             // Start flag
        0x0D,                   // Length 
        0x01,                   // Protocol (Login)
        0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, // IMEI BCD
        0x00, 0x01,             // Serial Number
        0xF4, 0x2E,             // Pre-calculated Valid CRC16 (Calculated correctly by server's table)
        0x0D, 0x0A              // End Flag
    ]);

    console.log('Sending Concox Login Payload...');
    client.write(loginPacket);
});

client.on('data', (data: Buffer | string) => {
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    console.log('Received ACK Response from Server:', buf.toString('hex'));

    // 2. Once authenticated, instantly transmit a Location Packet (Protocol 0x22)
    // Structured with corrected Length (0x1B = 27 bytes) and matching CRC (0xDEFA)
    const locationPacket = Buffer.from([
        0x78, 0x78,             // Start flag
        0x1B,                   // Corrected Length (27 bytes)
        0x22,                   // Protocol (Location)
        0x1A, 0x05, 0x12, 0x0F, 0x1E, 0x28, // Date: 2026-05-18 15:30:40
        0x0C,                   // Satellites
        0x02, 0x2A, 0x95, 0x70, // Latitude: 36.3300° N (Raw scaled)
        0x07, 0x54, 0x83, 0xC0, // Longitude: 123.0100° E (Raw scaled)
        0x28,                   // Speed: 40 km/h
        0x14, 0x00,             // Course & Status (GPS Positioned, North, East)
        0x00, 0x00, 0x00, 0x00, // Device Status IDs
        0x00, 0x02,             // Serial Number
        0xDE, 0xFA,             // Pre-calculated Valid CRC16 (Calculated correctly by server's table)
        0x0D, 0x0A              // End Flag
    ]);

    setTimeout(() => {
        console.log('Sending Concox Location Payload...');
        client.write(locationPacket);
    }, 1000);
});
