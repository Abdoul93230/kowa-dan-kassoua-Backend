// Outils temps réel partagés (contrôleurs HTTP + Socket.IO)
//
// Chaque socket rejoint la room personnelle `user:<id>` à la connexion : on émet vers un
// utilisateur sans parcourir la liste des connectés, et cela fonctionne tel quel sur
// plusieurs serveurs avec l'adaptateur Redis de Socket.IO.

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

const userRoom = (userId) => `user:${userId}`;

// Total des messages non lus d'un utilisateur : deux agrégations sur index
// (au lieu de charger toutes ses conversations en mémoire)
async function getUnreadTotal(userId) {
  const oid = new mongoose.Types.ObjectId(String(userId));
  const sumFor = (role) => Conversation.aggregate([
    { $match: { [`participants.${role}`]: oid, status: 'active', [`unreadCount.${role}`]: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: `$unreadCount.${role}` } } },
  ]);
  const [asBuyer, asSeller] = await Promise.all([sumFor('buyer'), sumFor('seller')]);
  return (asBuyer[0]?.total || 0) + (asSeller[0]?.total || 0);
}

// Pousse le nouveau total au client : il n'a plus besoin de le redemander en HTTP
async function emitUnreadCount(io, userId) {
  if (!io || !userId) return;
  try {
    const unreadCount = await getUnreadTotal(userId);
    io.to(userRoom(userId)).emit('unreadCount:changed', { unreadCount });
  } catch (error) {
    console.error('⚠️ Erreur émission compteur non lus:', error.message);
  }
}

// Met à jour l'aperçu de la conversation et le compteur de non-lus du destinataire en UNE
// écriture atomique. Le $inc évite que deux messages simultanés s'écrasent (l'ancien
// « lire → +1 → save » perdait des incréments). L'objet en mémoire est aussi mis à jour
// pour les émissions temps réel qui suivent.
async function recordLastMessage(conversation, message, { isBuyer, deliveredAt = null, postClosure = false, preview } = {}) {
  const lastMessage = {
    id: message._id,
    content: preview ?? message.content,
    senderId: message.senderId.toString(),
    senderName: message.senderName,
    timestamp: message.timestamp,
    delivered: Boolean(deliveredAt),
    deliveredAt,
    read: false,
    readAt: null,
    type: message.type,
    postClosure,
  };
  const recipientRole = isBuyer ? 'seller' : 'buyer';

  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastMessage }, $inc: { [`unreadCount.${recipientRole}`]: 1 } }
  );

  conversation.lastMessage = lastMessage;
  conversation.unreadCount[recipientRole] = (conversation.unreadCount[recipientRole] || 0) + 1;
  conversation.updatedAt = new Date();
  return lastMessage;
}

// ─── Présence ────────────────────────────────────────────────────────────────
// Un utilisateur est en ligne s'il a au moins un socket dans sa room personnelle, sur
// n'importe quel serveur (avec l'adaptateur Redis, fetchSockets interroge toute la grappe).
async function isUserOnline(io, userId) {
  if (!io || !userId) return false;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  return sockets.length > 0;
}

// Parmi `userIds`, ceux qui sont en ligne (une seule interrogation pour tous)
async function onlineAmong(io, userIds) {
  const ids = [...new Set((userIds || []).map(String))];
  if (!io || ids.length === 0) return new Set();
  const sockets = await io.in(ids.map(userRoom)).fetchSockets();
  return new Set(sockets.map((s) => String(s.data?.userId || '')).filter((id) => ids.includes(id)));
}

// Accusé de livraison : à la room de la conversation ET à l'expéditeur (même hors de la room).
// Une émission vers plusieurs rooms n'envoie qu'une fois à chaque socket.
function emitMessageDelivered({ io, conversationId, messageId, deliveredAt, recipientId, senderId }) {
  if (!io || !conversationId || !messageId) return;
  io.to(String(conversationId)).to(userRoom(senderId)).emit('message:delivered', {
    conversationId: String(conversationId),
    messageId: String(messageId),
    deliveredAt,
    recipientId,
  });
}

module.exports = {
  userRoom,
  getUnreadTotal,
  emitUnreadCount,
  recordLastMessage,
  isUserOnline,
  onlineAmong,
  emitMessageDelivered,
};
