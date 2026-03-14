console.log("🚀 Firebase Admin file is being loaded...");

const admin = require('firebase-admin');

try {
  const base64Data = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!base64Data) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT is missing.");
  } else {
    const decodedString = Buffer.from(base64Data, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(decodedString);
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("✅ Firebase Admin successfully initialized!");
    }
  }
} catch (error) {
  console.error("❌ Firebase Initialization Error:", error.message);
}

const messaging = admin.apps.length ? admin.messaging() : null;
module.exports = messaging;