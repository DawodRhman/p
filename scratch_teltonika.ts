import { Buffer } from 'buffer';

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

console.log("Packet Length:", codec8Packet.length);
const dataLength = codec8Packet.readUInt32BE(4);
console.log("Parsed Length field:", dataLength);
const totalExpected = 8 + dataLength + 4;
console.log("Total Expected Length:", totalExpected);

if (codec8Packet.length >= totalExpected) {
    console.log("SUCCESS! Buffer length is sufficient!");
} else {
    console.log("FAILED! Buffer length is short!");
}
