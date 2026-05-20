import * as net from 'net';
import * as mqtt from 'mqtt';

interface NormalizedLocation {
    deviceId: string;
    protocol: 'teltonika' | 'concox';
    latitude: number;
    longitude: number;
    timestamp: Date;
    speed: number;
}

interface SocketSession {
    deviceId?: string;
    protocol?: 'teltonika' | 'concox';
    buffer: Buffer;
}

const SERVER_PORT = 9000;
const MQTT_BROKER_URL = 'mqtt://localhost:1883'; // Change to your broker URL
const MQTT_TOPIC_PREFIX = 'telemetry/gps';

// Initialize MQTT Client with connection limit to avoid spamming the console
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    reconnectPeriod: 10000, // Reconnect every 10 seconds instead of immediately
    connectTimeout: 5000
});

mqttClient.on('connect', () => {
    console.log(`Connected successfully to MQTT Broker at: ${MQTT_BROKER_URL}`);
});

mqttClient.on('error', (err) => {
    console.error(`[MQTT CONNECTION ERROR] Could not connect to MQTT Broker at ${MQTT_BROKER_URL}.`);
    console.error(`  Reason: ${err.message || 'Broker offline. The TCP parsing server is still fully active.'}`);
});

const sessions = new Map<net.Socket, SocketSession>();

const server = net.createServer((socket) => {
    console.log(`[SOCKET] New connection established from ${socket.remoteAddress}:${socket.remotePort}`);
    sessions.set(socket, { buffer: Buffer.alloc(0) });

    socket.on('data', (rawChunk: Buffer | string) => {
        const session = sessions.get(socket);
        if (!session) return;

        const chunk = typeof rawChunk === 'string' ? Buffer.from(rawChunk) : rawChunk;
        session.buffer = Buffer.concat([session.buffer, chunk]);
        processBuffer(socket, session);
    });

    socket.on('close', () => {
        console.log(`[SOCKET] Connection closed for ${socket.remoteAddress}:${socket.remotePort}`);
        sessions.delete(socket);
    });

    socket.on('error', (err) => console.error('Socket error:', err.message));
});

function processBuffer(socket: net.Socket, session: SocketSession) {
    if (session.buffer.length < 4) return;

    if (!session.protocol) {
        const leading32 = session.buffer.readUInt32BE(0);
        const leading16 = session.buffer.readUInt16BE(0);

        if (leading32 === 0x00000000) {
            session.protocol = 'teltonika';
        } else if (leading16 === 0x7878 || leading16 === 0x7979) {
            session.protocol = 'concox';
        } else if (leading16 >= 0x0008 && leading16 <= 0x0040) { 
            session.protocol = 'teltonika';
        } else {
            session.buffer = Buffer.alloc(0); // Clear unparseable streams
            return;
        }
    }

    if (session.protocol === 'teltonika') {
        parseTeltonikaStream(socket, session);
    } else {
        parseConcoxStream(socket, session);
    }
}

/**
 * CRC-16 XMODEM Look-Up Table for Concox Validation
 */
const crc16Table = new Uint16Array([
    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
    0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
    0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
    0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
    0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
    0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
    0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
    0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
    0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
    0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
    0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12,
    0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
    0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41,
    0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
    0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
    0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
    0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
    0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
    0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e,
    0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
    0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
    0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
    0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c,
    0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
    0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab,
    0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
    0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
    0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
    0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9,
    0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
    0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8,
    0x6e17, 0x7e36, 0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0
]);

function calculateCRC16(buffer: Buffer): number {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        const val = buffer[i];
        if (val !== undefined) {
            const tableIndex = ((crc >> 8) ^ val) & 0xFF;
            const tableValue = crc16Table[tableIndex];
            if (tableValue !== undefined) {
                crc = ((crc << 8) ^ tableValue) & 0xFFFF;
            }
        }
    }
    return crc;
}

/**
 * Parses Concox Protocol Streams with Checksum Validations
 */
function parseConcoxStream(socket: net.Socket, session: SocketSession) {
    if (session.buffer.length < 5) return;
    
    const startFlag = session.buffer.readUInt16BE(0);
    const packetLength = session.buffer.readUInt8(2);
    const totalFrameLength = packetLength + 5; 

    if (session.buffer.length < totalFrameLength) return;

    // CRC VALIDATION STEP
    // Concox CRC covers everything from packet length byte up to the end of the data payload
    const crcStartIndex = 2; 
    const crcLength = totalFrameLength - 6; // Excludes start flag (2B), CRC (2B), and end flag (2B)
    const dataToVerify = session.buffer.slice(crcStartIndex, crcStartIndex + crcLength);
    
    const calculatedCrc = calculateCRC16(dataToVerify);
    const receivedCrc = session.buffer.readUInt16BE(totalFrameLength - 4);

    if (calculatedCrc !== receivedCrc) {
        console.error(`[CRC ERROR] Concox frame validation failed. Calculated: ${calculatedCrc.toString(16)}, Received: ${receivedCrc.toString(16)}. Corrupt packet dropped.`);
        session.buffer = session.buffer.slice(totalFrameLength); // Discard bad frame
        if (session.buffer.length > 0) processBuffer(socket, session);
        return;
    }

    const protocolNumber = session.buffer.readUInt8(3);
    const serialNumber = session.buffer.readUInt16BE(totalFrameLength - 6);

    if (protocolNumber === 0x01) {
        session.deviceId = session.buffer.slice(4, 12).toString('hex');
        console.log(`Concox logged in successfully. ID: ${session.deviceId}`);
        sendConcoxAck(socket, startFlag, protocolNumber, serialNumber);
    } 
    else if (protocolNumber === 0x12 || protocolNumber === 0x22) {
        let offset = 4;
        
        const year = session.buffer.readUInt8(offset);
        const month = session.buffer.readUInt8(offset + 1);
        const day = session.buffer.readUInt8(offset + 2);
        const hour = session.buffer.readUInt8(offset + 3);
        const minute = session.buffer.readUInt8(offset + 4);
        const second = session.buffer.readUInt8(offset + 5);
        const timestamp = new Date(Date.UTC(2000 + year, month - 1, day, hour, minute, second));
        
        offset += 7; // Increment past time & satellite counters

        const rawLat = session.buffer.readUInt32BE(offset);
        const rawLon = session.buffer.readUInt32BE(offset + 4);
        let lat = rawLat / 1800000;
        let lon = rawLon / 1800000;
        
        offset += 8;
        const speed = session.buffer.readUInt8(offset);
        const courseStatus = session.buffer.readUInt16BE(offset + 1);
        
        const isGpsPositioned = (courseStatus & 0x1000) !== 0;
        const isWest = (courseStatus & 0x0800) !== 0;
        const isNorth = (courseStatus & 0x0400) !== 0;

        if (!isNorth) lat = -lat;
        if (isWest) lon = -lon;

        if (isGpsPositioned && session.deviceId) {
            publishToMQTT({
                deviceId: session.deviceId,
                protocol: 'concox',
                latitude: lat,
                longitude: lon,
                timestamp: timestamp,
                speed: speed
            });
        }

        if (protocolNumber === 0x22) {
            sendConcoxAck(socket, startFlag, protocolNumber, serialNumber);
        }
    }
    else if (protocolNumber === 0x13 || protocolNumber === 0x23) {
        sendConcoxAck(socket, startFlag, protocolNumber, serialNumber);
    }

    session.buffer = session.buffer.slice(totalFrameLength);
    if (session.buffer.length > 0) processBuffer(socket, session);
}

/**
 * Generates an ACK frame with matching calculated verification bytes for Concox
 */
function sendConcoxAck(socket: net.Socket, startFlag: number, protocol: number, serial: number) {
    const ackBody = Buffer.alloc(4);
    ackBody.writeUInt8(0x05, 0); // Length
    ackBody.writeUInt8(protocol, 1);
    ackBody.writeUInt16BE(serial, 2);

    const computedCrc = calculateCRC16(ackBody);

    const ackFrame = Buffer.alloc(10);
    ackFrame.writeUInt16BE(startFlag, 0);
    ackBody.copy(ackFrame, 2);
    ackFrame.writeUInt16BE(computedCrc, 6);
    ackFrame.writeUInt16BE(0x0D0A, 8); // End mark (\r\n)

    socket.write(ackFrame);
}

/**
 * Parses Teltonika Codec 8 Streams
 */
function parseTeltonikaStream(socket: net.Socket, session: SocketSession) {
    if (!session.deviceId) {
        if (session.buffer.length < 2) return;
        const imeiLength = session.buffer.readUInt16BE(0);
        
        if (session.buffer.length < 2 + imeiLength) return;
        session.deviceId = session.buffer.slice(2, 2 + imeiLength).toString('ascii');
        session.buffer = session.buffer.slice(2 + imeiLength);
        
        socket.write(Buffer.from([0x01])); 
        console.log(`Teltonika logged in successfully. ID: ${session.deviceId}`);
        
        if (session.buffer.length >= 4) processBuffer(socket, session);
        return;
    }

    if (session.buffer.length < 12) return;
    const dataLength = session.buffer.readUInt32BE(4);
    
    if (session.buffer.length < 8 + dataLength + 4) return; 
    const codecId = session.buffer.readUInt8(8);
    const totalRecords = session.buffer.readUInt8(9);

    console.log(`[DATA] Received Codec ID 0x${codecId.toString(16)} with ${totalRecords} records.`);

    if (codecId === 0x08) {
        let offset = 10;
        try {
            for (let i = 0; i < totalRecords; i++) {
                if (offset + 15 > session.buffer.length) break;

            const timestampLong = session.buffer.slice(offset, offset + 8);
            const timestampMs = timestampLong.reduce((acc, byte) => (acc * 256) + byte, 0);

            const lon = session.buffer.readInt32BE(offset + 9) / 10000000;
            const lat = session.buffer.readInt32BE(offset + 13) / 10000000;
            const speed = session.buffer.readUInt16BE(offset + 22);

            offset += 24; 

            // Fast-forward over variable I/O sensor block
            offset += 2; // Skip eventId and total elements byte
            const count1B = session.buffer.readUInt8(offset); offset += 1 + (count1B * 2);
            const count2B = session.buffer.readUInt8(offset); offset += 1 + (count2B * 3);
            const count4B = session.buffer.readUInt8(offset); offset += 1 + (count4B * 5);
            const count8B = session.buffer.readUInt8(offset); offset += 1 + (count8B * 9);

            if (lat !== 0 && lon !== 0) {
                publishToMQTT({
                    deviceId: session.deviceId,
                    protocol: 'teltonika',
                    latitude: lat,
                    longitude: lon,
                    timestamp: new Date(timestampMs),
                    speed: speed
                });
            } else {
                console.log(`[WAITING FOR GPS FIX] Device ${session.deviceId} reported 0,0 coordinates. Make sure the vehicle is outdoors.`);
            }
        }
    } catch (err: any) {
        console.error(`[CRASH PREVENTED] Error parsing Teltonika Codec 8 payload: ${err.message}. Offset: ${offset}, Buffer Size: ${session.buffer.length}`);
        // Dump the raw buffer for debugging
        console.error(`[RAW BUFFER] ${session.buffer.toString('hex')}`);
    }

    const ack = Buffer.alloc(4);
    ack.writeUInt32BE(totalRecords, 0);
    socket.write(ack);

    session.buffer = session.buffer.slice(8 + dataLength + 4);
    if (session.buffer.length > 0) processBuffer(socket, session);
}

/**
 * Formats Normalized JSON Payloads and routes to MQTT Broker
 */
function publishToMQTT(location: NormalizedLocation) {
    if (!mqttClient.connected) {
        console.warn(`\n[MQTT OFFLINE DRY-RUN] Message parsed successfully!`);
        console.log(`📡 Device ID:  ${location.deviceId}`);
        console.log(`🔌 Protocol:   ${location.protocol.toUpperCase()}`);
        console.log(`🌐 Coordinates: ${location.latitude}, ${location.longitude}`);
        console.log(`⚡ Speed:       ${location.speed} km/h`);
        console.log(`📅 Timestamp:   ${location.timestamp.toISOString()}`);
        console.log(`-----------------------------------------------------`);
        return;
    }

    const topic = `${MQTT_TOPIC_PREFIX}/${location.protocol}/${location.deviceId}`;
    const payload = JSON.stringify({
        lat: location.latitude,
        lon: location.longitude,
        speed: location.speed,
        time: location.timestamp.toISOString(),
        proc_time: new Date().toISOString()
    });

    // Publish with QoS 1 to guarantee at least once delivery
    mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) console.error(`Failed to publish message to topic ${topic}:`, err.message);
    });
}

server.listen(SERVER_PORT, () => {
    console.log(`Gateway Online. Listening on Port ${SERVER_PORT}. Routing to MQTT.`);
});
