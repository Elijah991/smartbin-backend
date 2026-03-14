require('dotenv').config();

// Initialize Firebase Admin as early as possible
require('./communication/firebaseAdmin');

// Start the main Express server
require('./communication/server');

