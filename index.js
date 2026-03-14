require('dotenv').config();

// Initialize Firebase Admin as early as possible
require('./firebaseAdmin');

// Start the main Express server
require('./communication/server');

