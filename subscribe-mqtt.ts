import * as mqtt from 'mqtt';

const MQTT_BROKER_URL = 'mqtt://localhost:1883'; // Change to match your broker
const TOPIC = 'telemetry/gps/#';

console.log(`Connecting to MQTT Broker at: ${MQTT_BROKER_URL}...`);
const client = mqtt.connect(MQTT_BROKER_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 5000
});

client.on('connect', () => {
    console.log(`Connected successfully! Subscribing to topic: ${TOPIC}`);
    client.subscribe(TOPIC, (err) => {
        if (err) {
            console.error(`Subscription failed:`, err.message);
        } else {
            console.log(`Subscribed. Waiting for incoming telemetry messages...\n`);
        }
    });
});

client.on('message', (topic, message) => {
    console.log(`\n-----------------------------------------------------`);
    console.log(`📬 Received message on Topic: [${topic}]`);
    try {
        const parsed = JSON.parse(message.toString());
        console.log(JSON.stringify(parsed, null, 2));
    } catch {
        console.log(`Raw Payload: ${message.toString()}`);
    }
    console.log(`-----------------------------------------------------`);
});

client.on('error', (err) => {
    console.error(`[CONNECTION ERROR] Could not connect to MQTT Broker at ${MQTT_BROKER_URL}.`);
    console.error(`  Reason: ${err.message || 'Broker offline'}`);
});
