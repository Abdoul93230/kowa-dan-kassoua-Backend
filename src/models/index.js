// 📦 Export centralisé de tous les modèles
const User = require('./User');
const Product = require('./Product');
const Review = require('./Review');
const Conversation = require('./Conversation');
const Message = require('./Message');

module.exports = {
  User,
  Product,
  Review,
  Conversation,
  Message
};
