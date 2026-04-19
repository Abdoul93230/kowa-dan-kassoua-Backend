const axios = require('axios');

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

const buildNotificationMessages = ({ tokens = [], title, body, data = {} }) => {
  return tokens
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high'
    }));
};

const sendExpoPushNotifications = async ({ tokens = [], title, body, data = {} }) => {
  const messages = buildNotificationMessages({ tokens, title, body, data });

  if (messages.length === 0) {
    return { success: true, sent: 0 };
  }

  const response = await axios.post(EXPO_PUSH_ENDPOINT, messages, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json'
    }
  });

  return {
    success: true,
    sent: messages.length,
    data: response.data
  };
};

module.exports = {
  sendExpoPushNotifications
};