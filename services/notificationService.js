const messaging = require('../firebaseAdmin');

const sendBinAlert = async (fcmToken, binCode, status) => {
  const message = {
    notification: {
      title: `SmartBin Alert: ${binCode} 🚨`,
      body: `The bin at your location is ${status}. Please attend to it!`,
    },
    token: fcmToken, // This comes from the 'users' table in your DB
  };

  try {
    if (!messaging) {
      throw new Error('Firebase Messaging is not initialized. Please set FIREBASE_SERVICE_ACCOUNT environment variable.');
    }

    const response = await messaging.send(message);
    console.log('Notification sent successfully:', response);
    return response;
  } catch (error) {
    console.error('Notification failed:', error);
    throw error;
  }
};

module.exports = { sendBinAlert };