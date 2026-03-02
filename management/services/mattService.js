const mqtt = require('mqtt');
require('dotenv').config();

class MQTTService {
    constructor() {
        this.client = null;
        this.subscribers = new Map();
        this.connect();
    }

    connect() {
        const options = {
            clientId: process.env.MQTT_CLIENT_ID || 'smartbin_backend',
            clean: true,
            reconnectPeriod: 1000,
            connectTimeout: 30 * 1000,
        };

        if (process.env.MQTT_USERNAME) {
            options.username = process.env.MQTT_USERNAME;
            options.password = process.env.MQTT_PASSWORD;
        }

        this.client = mqtt.connect(process.env.MQTT_BROKER || 'mqtt://localhost:1883', options);

        this.client.on('connect', () => {
            console.log('✅ MQTT Connected successfully');
            
            // Subscribe to bin status updates
            this.client.subscribe('smartbin/bins/+/status', (err) => {
                if (!err) console.log('📡 Subscribed to bin status updates');
            });

            // Subscribe to bin level updates
            this.client.subscribe('smartbin/bins/+/level', (err) => {
                if (!err) console.log('📡 Subscribed to bin level updates');
            });
        });

        this.client.on('error', (error) => {
            console.error('❌ MQTT Error:', error.message);
        });

        this.client.on('message', (topic, message) => {
            this.handleMessage(topic, message);
        });

        this.client.on('offline', () => {
            console.log('⚠️  MQTT Client offline');
        });

        this.client.on('reconnect', () => {
            console.log('🔄 MQTT Reconnecting...');
        });
    }

    handleMessage(topic, message) {
        try {
            const payload = JSON.parse(message.toString());
            console.log(`📨 Received message on ${topic}:`, payload);

            // Notify all subscribers
            this.subscribers.forEach((callback) => {
                callback(topic, payload);
            });
        } catch (error) {
            console.error('Error parsing MQTT message:', error.message);
        }
    }

    // Publish message to topic
    publish(topic, message) {
        if (!this.client || !this.client.connected) {
            console.error('MQTT client not connected');
            return false;
        }

        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        
        this.client.publish(topic, payload, { qos: 1, retain: false }, (error) => {
            if (error) {
                console.error('Error publishing message:', error);
            } else {
                console.log(`✉️  Published to ${topic}:`, message);
            }
        });

        return true;
    }

    // Subscribe to custom topic
    subscribe(topic, callback) {
        const subscriptionId = Date.now().toString();
        this.subscribers.set(subscriptionId, callback);

        this.client.subscribe(topic, (err) => {
            if (err) {
                console.error(`Error subscribing to ${topic}:`, err);
            } else {
                console.log(`📡 Subscribed to ${topic}`);
            }
        });

        return subscriptionId;
    }

    // Unsubscribe from topic
    unsubscribe(subscriptionId) {
        this.subscribers.delete(subscriptionId);
    }

    // Publish notification to user
    publishNotification(userId, notification) {
        const topic = `smartbin/notifications/${userId}`;
        this.publish(topic, notification);
    }

    // Publish bin status update
    publishBinStatus(binCode, status) {
        const topic = `smartbin/bins/${binCode}/status`;
        this.publish(topic, status);
    }

    // Publish bin level update
    publishBinLevel(binCode, level) {
        const topic = `smartbin/bins/${binCode}/level`;
        this.publish(topic, { fill_level: level, timestamp: new Date() });
    }

    disconnect() {
        if (this.client) {
            this.client.end();
            console.log('MQTT disconnected');
        }
    }
}

// Singleton instance
const mqttService = new MQTTService();

module.exports = mqttService;