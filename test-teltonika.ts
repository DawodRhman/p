import * as net from 'net';

// Define the static Codec 8 Data Packet (1 Record containing valid binary coordinates)
// Structured with corrected body length: 0x00000021 = 33 bytes
const codec8Packet = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // 4 bytes Preamble
    0x00, 0x00, 0x00, 0x21, // Corrected Data field length (33 bytes total body)
    0x08,                   // Codec ID (Codec 8)
    0x01,                   // Number of Data 1 (1 Tracking record)
    
    // --- START RECORD ---
    0x00, 0x00, 0x01, 0x9D, 0xE7, 0x48, 0x1A, 0x00, // Timestamp in MS
    0x01,                   // Priority
    0x06, 0x9A, 0x3E, 0x20, // Longitude: 110.7717408° E
    0x17, 0xD4, 0x43, 0x30, // Latitude: 39.9786800° N
    0x00, 0xAA,             // Altitude: 170m
    0x00, 0x5A,             // Angle: 90 degrees
    0x07,                   // Satellites: 7 active
    0x00, 0x32,             // Speed: 50 km/h
    
    // --- IO ELEMENT BLOCK (Empty / 0 values) ---
    0x00,                   // Event IO ID
    0x00,                   // Total elements counter
    0x00,                   // 1B elements
    0x00,                   // 2B elements
    0x00,                   // 4B elements
    0x00,                   // 8B elements
    // --- END RECORD ---
    
    0x01,                   // Number of Data 2 (Verification matching footer)
    0x00, 0x00, 0x00, 0x00  // CRC placeholder
]);

const client = net.createConnection({ port: 9000 }, () => {
    console.log('Connected to GPS Gateway as a Teltonika Device');

    // 1. Send Handshake packet: 15-byte ASCII IMEI string prefixed with a 2-byte length header
    const imei = "352093085934940";
    const handshake = Buffer.alloc(2 + imei.length);
    handshake.writeUInt16BE(imei.length, 0);
    handshake.write(imei, 2, 'ascii');

    console.log('Sending Teltonika IMEI Handshake...');
    client.write(handshake);
});

client.on('data', (data: Buffer | string) => {
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    
    // Case A: Server accepted the initial IMEI handshake
    if (buf[0] === 0x01) {
        console.log('Server accepted IMEI. Sending Codec 8 Location frame...');
        client.write(codec8Packet);
    } 
    // Case B: Server responded to a location packet with the acknowledgment counter
    else {
        console.log('Received acknowledgment counter from server:', buf.readUInt32BE(0));
        
        // Loop continuously to simulate real-world periodic transmissions (every 2 seconds)
        setTimeout(() => {
            console.log('Sending next Codec 8 Location frame...');
            client.write(codec8Packet);
        }, 2000);
    }
});
