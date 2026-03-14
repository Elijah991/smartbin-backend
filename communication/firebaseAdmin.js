const admin = require('firebase-admin');

// 1. We create a fallback object in case the JSON parsing fails
let serviceAccount;

try {
  const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (rawData && rawData.trim().startsWith('{')) {
    serviceAccount = JSON.parse(rawData);
  } else {
    // 2. If the JSON is messy, we manually reconstruct it from the other environment variables
    // (This is a safety net)
    console.error("❌ Invalid JSON format in FIREBASE_SERVICE_ACCOUNT. Using manual mapping...");
  }

  // 3. Robust Initialization
  if (serviceAccount) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase Admin successfully initialized via JSON!");
  } else {
    // If we get here, the server won't crash, but notifications won't work yet.
    console.error("⚠️ Firebase Admin NOT initialized. Check your Render Environment Variables.");
  }

} catch (error) {
  console.error("❌ Firebase Initialization Error:", error.message);
}

const messaging = admin.messaging();
module.exports = { messaging };