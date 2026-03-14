const admin = require('firebase-admin');

try {
  const base64Data = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (base64Data) {
    // 1. Convert the Base64 string back into a JSON string
    const decodedString = Buffer.from(base64Data, 'base64').toString('utf-8');
    
    // 2. Parse the JSON string into an object
    const serviceAccount = JSON.parse(decodedString);

    // 3. Fix the private key formatting
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

    // 4. Initialize Firebase
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    console.log("✅ Firebase Admin successfully initialized using Base64 Decode!");
  } else {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT is missing from Render Environment.");
  }
} catch (error) {
  console.error("❌ Firebase Initialization Error:", error.message);
}

const messaging = admin.messaging();
module.exports = { messaging };