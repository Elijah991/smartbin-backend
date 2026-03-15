const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
// Initialize Firebase Admin SDK on server startup
require('../firebaseAdmin');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const binRoutes = require('./routes/bins');
const directionsRoutes = require('./routes/directions');
//const notificationRoutes = require('./routes/notifications');
const db = require('../config/database');
const dashboardRoutes = require('../management/dashboard');

// Import services
//const mqttService = require('./services/mqttService');
//const db = require('./config/database');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors({
    origin: '*', // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'SmartBin API is running',
        timestamp: new Date(),
        mqtt_connected: (typeof mqttService !== 'undefined') && mqttService.client && mqttService.client.connected
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bins', binRoutes);
app.use('/api/directions', directionsRoutes);
//app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Test notification route
app.get('/test-notif', async (req, res) => {
    console.log("Checking token for admin@smartbin.com...");
    try {
        const result = await db.query('SELECT fcm_token FROM users WHERE email = $1', ['admin@smartbin.com']);
        if (result.rows.length === 0 || !result.rows[0].fcm_token) {
            return res.json({ message: "User/Token not found" });
        }
        const userToken = result.rows[0].fcm_token;
        const messaging = require('../firebaseAdmin');
        const message = {
            notification: {
                title: 'SmartBin Test',
                body: 'Success! Your backend is talking to Firebase.'
            },
            token: userToken
        };
        await messaging.send(message);
        res.json({ message: "Notification sent!" });
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({ message: "Error sending notification" });
    }
});

// Database check route
app.get('/db-check', async (req, res) => {
  try {
    const result = await db.query("SELECT email, fcm_token FROM users WHERE email = 'admin@smartbin.com'");
    if (result.rows.length === 0) return res.send("❌ User 'admin@smartbin.com' not found.");
    res.send(`✅ User found! Token status: ${result.rows[0].fcm_token ? 'Has Token' : 'No Token'}`);
  } catch (err) {
    res.status(500).send("❌ DB Error: " + err.message);
  }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Endpoint not found' 
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// MQTT Message Handler - Update database when IoT sensors send data
// mqttService.subscribe('smartbin/bins/+/level', async (topic, payload) => {
//     try {
//         // Extract bin code from topic: smartbin/bins/BIN001/level
//         const binCode = topic.split('/')[2];
        
//         // Find bin in database
//         const [bins] = await db.query('SELECT id FROM bins WHERE bin_code = ?', [binCode]);
        
//         if (bins.length > 0) {
//             const binId = bins[0].id;
//             const fillLevel = payload.fill_level || payload.level || 0;
            
//             // Update bin level via API endpoint logic
//             const response = await fetch(`http://localhost:${PORT}/api/bins/${binId}/level`, {
//                 method: 'PATCH',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ fill_level: fillLevel })
//             });
            
//             console.log(`Updated ${binCode} fill level to ${fillLevel}%`);
//         }
//     } catch (error) {
//         console.error('Error processing MQTT message:', error);
//     }
// });

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('🚀 SmartBin Backend Server Started');
    console.log('='.repeat(50));
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Accessible to Emulator at: http://10.0.2.2:${PORT}/api`);
    console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
    console.log('='.repeat(50));
});

// Graceful shutdown
// process.on('SIGTERM', () => {
//     console.log('SIGTERM received, closing server...');
//     mqttService.disconnect();
//     process.exit(0);
// });

// process.on('SIGINT', () => {
//     console.log('SIGINT received, closing server...');
//     mqttService.disconnect();
//     process.exit(0);
// });

module.exports = app;