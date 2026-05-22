import * as net from 'net';
import * as mqtt from 'mqtt';

interface NormalizedLocation {
    deviceId: string;
    protocol: 'teltonika' | 'concox';
    latitude: number;
    longitude: number;
    timestamp: Date;
    speed: number;
    angle?: number;
    altitude?: number;
    satellites?: number;
    io?: Record<number, number>;
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
 * Calculates CRC-16/X.25 for Concox Protocol (Polynomial: 0x8408)
 */
function calculateCRC16(buffer: Buffer): number {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0x8408;
            else crc >>= 1;
        }
    }
    return (~crc) & 0xFFFF;
}

/**
 * Parses Concox Protocol Streams with Checksum Validations
 */
function parseConcoxStream(socket: net.Socket, session: SocketSession) {
    if (session.buffer.length < 5) return;

    const startFlag = session.buffer.readUInt16BE(0);

    let packetLength: number;
    let totalFrameLength: number;
    let protocolOffset: number;

    if (startFlag === 0x7878) {
        packetLength = session.buffer.readUInt8(2);
        totalFrameLength = packetLength + 5;
        protocolOffset = 3;
    } else if (startFlag === 0x7979) {
        packetLength = session.buffer.readUInt16BE(2);
        totalFrameLength = packetLength + 6;
        protocolOffset = 4;
    } else {
        // Corrupt stream. Find next 0x78 or 0x79 to recover
        const next78 = session.buffer.indexOf(0x78);
        const next79 = session.buffer.indexOf(0x79);
        const next = Math.min(next78 !== -1 ? next78 : 99999, next79 !== -1 ? next79 : 99999);
        session.buffer = session.buffer.slice(next !== 99999 && next > 0 ? next : 1);
        if (session.buffer.length > 0) setImmediate(() => processBuffer(socket, session));
        return;
    }

    if (session.buffer.length < totalFrameLength) return;

    // CRC VALIDATION STEP
    const crcStartIndex = 2;
    const crcLength = totalFrameLength - 6; // Excludes start flag (2B), CRC (2B), and end flag (2B)
    const dataToVerify = session.buffer.slice(crcStartIndex, crcStartIndex + crcLength);

    const calculatedCrc = calculateCRC16(dataToVerify);
    const receivedCrc = session.buffer.readUInt16BE(totalFrameLength - 4);

    if (calculatedCrc !== receivedCrc) {
        console.error(`[CRC ERROR] Concox frame validation failed. Calculated: ${calculatedCrc.toString(16)}, Received: ${receivedCrc.toString(16)}. Corrupt packet dropped.`);
        console.error(`[RAW CONCOX BUFFER] ${session.buffer.slice(0, totalFrameLength).toString('hex')}`);
        session.buffer = session.buffer.slice(totalFrameLength); // Discard bad frame
        if (session.buffer.length > 0) setImmediate(() => processBuffer(socket, session));
        return;
    }

    const protocolNumber = session.buffer.readUInt8(protocolOffset);
    const serialNumber = session.buffer.readUInt16BE(totalFrameLength - 6);

    console.log(`[CONCOX DATA] Received Protocol ID 0x${protocolNumber.toString(16)}`);

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
        } else {
            console.log(`[WAITING FOR GPS FIX] Concox Device ${session.deviceId} reported coordinates without lock.`);
        }

        if (protocolNumber === 0x22) {
            sendConcoxAck(socket, startFlag, protocolNumber, serialNumber);
        }
    }
    else if (protocolNumber === 0x13 || protocolNumber === 0x23) {
        console.log(`[CONCOX HEARTBEAT] Device ${session.deviceId || 'Unknown'} is online (Heartbeat packet, no GPS data).`);
        sendConcoxAck(socket, startFlag, protocolNumber, serialNumber);
    }
    else if (protocolNumber === 0x8a) {
        console.log(`[CONCOX TIME SYNC] Device ${session.deviceId || 'Unknown'} requested time sync. Sending current UTC time.`);
        sendConcoxTimeSyncAck(socket, startFlag, protocolNumber, serialNumber);
    }
    else {
        console.log(`[CONCOX SYSTEM] Device sent protocol 0x${protocolNumber.toString(16)} (No GPS data).`);
        sendConcoxAck(socket, startFlag, protocolNumber, serialNumber);
    }

    session.buffer = session.buffer.slice(totalFrameLength);
    if (session.buffer.length > 0) setImmediate(() => processBuffer(socket, session));
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
 * Generates a Time Sync ACK frame for Concox (Protocol 0x8A)
 */
function sendConcoxTimeSyncAck(socket: net.Socket, startFlag: number, protocol: number, serial: number) {
    const now = new Date();
    const year = now.getUTCFullYear() - 2000;
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const second = now.getUTCSeconds();

    // Body: Length (1B) + Protocol (1B) + Year/Month/Day/Hour/Minute/Second (6B) + Serial (2B)
    const ackBody = Buffer.alloc(10);
    ackBody.writeUInt8(0x0B, 0); // Length: 1 (Protocol) + 6 (Time) + 2 (Serial) + 2 (CRC) = 11 (0x0B)
    ackBody.writeUInt8(protocol, 1);

    ackBody.writeUInt8(year, 2);
    ackBody.writeUInt8(month, 3);
    ackBody.writeUInt8(day, 4);
    ackBody.writeUInt8(hour, 5);
    ackBody.writeUInt8(minute, 6);
    ackBody.writeUInt8(second, 7);

    ackBody.writeUInt16BE(serial, 8);

    const computedCrc = calculateCRC16(ackBody);

    const ackFrame = Buffer.alloc(16);
    ackFrame.writeUInt16BE(startFlag, 0);
    ackBody.copy(ackFrame, 2);
    ackFrame.writeUInt16BE(computedCrc, 12);
    ackFrame.writeUInt16BE(0x0D0A, 14); // End mark (\r\n)

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

        if (session.buffer.length >= 4) setImmediate(() => processBuffer(socket, session));
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
                const altitude = session.buffer.readInt16BE(offset + 17);
                const angle = session.buffer.readUInt16BE(offset + 19);
                const satellites = session.buffer.readUInt8(offset + 21);
                const speed = session.buffer.readUInt16BE(offset + 22);

                offset += 24;

                const ioElements: Record<number, number> = {};
                const eventId = session.buffer.readUInt8(offset);
                const totalIo = session.buffer.readUInt8(offset + 1);
                offset += 2;

                const count1B = session.buffer.readUInt8(offset); offset += 1;
                for (let j = 0; j < count1B; j++) { ioElements[session.buffer.readUInt8(offset)] = session.buffer.readUInt8(offset + 1); offset += 2; }

                const count2B = session.buffer.readUInt8(offset); offset += 1;
                for (let j = 0; j < count2B; j++) { ioElements[session.buffer.readUInt8(offset)] = session.buffer.readUInt16BE(offset + 1); offset += 3; }

                const count4B = session.buffer.readUInt8(offset); offset += 1;
                for (let j = 0; j < count4B; j++) { ioElements[session.buffer.readUInt8(offset)] = session.buffer.readUInt32BE(offset + 1); offset += 5; }

                const count8B = session.buffer.readUInt8(offset); offset += 1;
                for (let j = 0; j < count8B; j++) {
                    const high = session.buffer.readUInt32BE(offset + 1);
                    const low = session.buffer.readUInt32BE(offset + 5);
                    ioElements[session.buffer.readUInt8(offset)] = (high * 4294967296) + low;
                    offset += 9;
                }

                if (lat !== 0 && lon !== 0) {
                    publishToMQTT({
                        deviceId: session.deviceId,
                        protocol: 'teltonika',
                        latitude: lat,
                        longitude: lon,
                        timestamp: new Date(timestampMs),
                        speed: speed,
                        angle: angle,
                        altitude: altitude,
                        satellites: satellites,
                        io: ioElements
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
        angle: location.angle || 0,
        altitude: location.altitude || 0,
        satellites: location.satellites || 0,
        time: location.timestamp.toISOString(),
        io: location.io || {},
        proc_time: new Date().toISOString()
    });

    console.log(`[MQTT PUBLISH] Topic: ${topic} | Payload: ${payload}`);

    // Publish with QoS 1 to guarantee at least once delivery
    mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) console.error(`Failed to publish message to topic ${topic}:`, err.message);
    });
}

server.listen(SERVER_PORT, () => {
    console.log(`Gateway Online. Listening on Port ${SERVER_PORT}. Routing to MQTT.`);
});
