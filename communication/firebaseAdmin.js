const admin = require('firebase-admin');

let serviceAccount;

try {
  const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!rawData) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT variable is missing in Render environment.");
  }

  // If the data starts with 'Service Account', it's not JSON, it's a raw string
  // This logic helps if the paste went slightly wrong
  if (rawData.trim().startsWith('{')) {
    serviceAccount = JSON.parse(rawData);
  } else {
    // If it's just the contents of the file without brackets, 
    // we need to make sure we aren't accidentally trying to parse a text title
    throw new Error("The Environment Variable does not start with '{'. Please re-copy the JSON file exactly.");
  }

  // Fix for private key formatting
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase Admin successfully initialized!");
} catch (error) {
  console.error("❌ Firebase Initialization Error:", error.message);
  // We don't want the server to crash, so we just log the error
}

const messaging = admin.messaging();
module.exports = { messaging };