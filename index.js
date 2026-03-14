require('dotenv').config();

console.log("Current Directory Files:", require('fs').readdirSync(__dirname));

// Initialize Firebase Admin as early as possible
require('./firebaseAdmin');

// Start the main Express server
require('./communication/server');

