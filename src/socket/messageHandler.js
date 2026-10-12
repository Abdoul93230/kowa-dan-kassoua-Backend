const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { sendExpoPushNotifications } = require('../utils/expoNotifications');
const {
  userRoom,
  emitUnreadCount,
  recordLastMessage,
  isUserOnline,
  onlineAmong,
  emitMessageDelivered,
} = require('../utils/realtime');

// Présence : plus de Map locale des connectés. Chaque socket est dans la room `user:<id>` ;
// avec l'adaptateur Redis, ces rooms sont partagées entre tous les serveurs.

const buildMessageNotificationBody = ({ senderName, content, type }) => {
  const safeSenderName = senderName || 'Nouveau message';

  if (type === 'audio') {
    return `${safeSenderName} vous a envoyé un message vocal.`;
  }

  const normalized = String(content || '').trim();
  if (!normalized) {
    return `${safeSenderName} vous a envoyé un message.`;
  }

  const preview = normalized.length > 90 ? `${normalized.substring(0, 87)}...` : normalized;
  return `${safeSenderName}: ${preview}`;
};

const notifyRecipientNewMessage = async ({ recipientId, conversationId, senderName, content, type }) => {
  if (!recipientId || !conversationId) return;

  try {
    const recipient = await User.findById(recipientId).select('expoPushTokens').lean();
    const tokens = Array.isArray(recipient?.expoPushTokens) ? recipient.expoPushTokens : [];

    if (tokens.length === 0) return;

    await sendExpoPushNotifications({
      tokens,
      title: 'Nouveau message',
      body: buildMessageNotificationBody({ senderName, content, type }),
      data: {
        type: 'message:new',
        conversationId: String(conversationId),
      }
    });
  } catch (notificationError) {
    console.error('⚠️ Erreur notification push message(socket):', notificationError.message);
  }
};

// L'autre participant d'une conversation (objet lean ou document)
const otherParticipantId = (conversation, userId) => {
  const buyer = String(conversation.participants.buyer?._id || conversation.participants.buyer);
  const seller = String(conversation.participants.seller?._id || conversation.participants.seller);
  return buyer === userId ? seller : buyer;
};

// Rooms personnelles des contacts d'un utilisateur
const contactRooms = (contacts) => [...(contacts || [])].map(userRoom);

/**
 * Configuration du gestionnaire Socket.IO pour la messagerie temps réel
 */
const setupSocketHandlers = (io) => {
  // Middleware d'authentification Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Token manquant'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('name avatar').lean();
      if (!user) return next(new Error('Utilisateur introuvable'));

      socket.userId = user._id.toString();
      socket.userData = {
        id: user._id.toString(),
        name: user.name,
        avatar: user.avatar
      };

      next();
    } catch (error) {
      next(new Error('Authentification échouée: ' + error.message));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Room personnelle : on cible l'utilisateur (tous ses appareils, sur tous les serveurs)
    socket.data.userId = userId;
    socket.join(userRoom(userId));

    // Contacts (interlocuteurs) + messages en attente de livraison — limités aux
    // conversations de CET utilisateur (avant : parcours de tous les messages non livrés de la base)
    socket.data.contacts = new Set();
    (async () => {
      try {
        const oid = new mongoose.Types.ObjectId(userId);
        const conversations = await Conversation.find({
          $or: [{ 'participants.buyer': oid }, { 'participants.seller': oid }],
          status: 'active',
        }).select('_id participants').lean();

        conversations.forEach((conv) => socket.data.contacts.add(otherParticipantId(conv, userId)));

        // Présence : uniquement les contacts en ligne (avant : liste de TOUS les connectés)
        const onlineContacts = await onlineAmong(io, [...socket.data.contacts]);
        socket.emit('users:online', { userIds: [...onlineContacts] });

        // Premier appareil connecté → prévenir ses contacts
        const ownSockets = await io.in(userRoom(userId)).fetchSockets();
        if (ownSockets.length === 1 && socket.data.contacts.size > 0) {
          io.to(contactRooms(socket.data.contacts)).emit('user:online', { userId });
        }

        if (conversations.length === 0) return;

        const pendingDeliveries = await Message.find({
          conversationId: { $in: conversations.map((conv) => conv._id) },
          delivered: false,
          senderId: { $ne: oid },
        }).select('_id conversationId senderId').lean();

        if (pendingDeliveries.length === 0) return;

        const deliveredAt = new Date();
        await Message.updateMany(
          { _id: { $in: pendingDeliveries.map((msg) => msg._id) } },
          { $set: { delivered: true, deliveredAt } }
        );

        pendingDeliveries.forEach((msg) => {
          emitMessageDelivered({
            io,
            conversationId: msg.conversationId.toString(),
            messageId: msg._id.toString(),
            deliveredAt,
            recipientId: userId,
            senderId: msg.senderId.toString(),
          });
        });
      } catch (connectError) {
        console.error('⚠️ Erreur initialisation socket:', connectError.message);
      }
    })();

    // ===============================================
    // 🏠 REJOINDRE UNE CONVERSATION
    // ===============================================
    socket.on('conversation:join', async (data) => {
      try {
        const { conversationId } = data || {};
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return;

        const conversation = await Conversation.findById(conversationId).select('participants').lean();
        if (!conversation) {
          return socket.emit('error', { message: 'Conversation introuvable' });
        }

        const isBuyer = conversation.participants.buyer.toString() === userId;
        const isSeller = conversation.participants.seller.toString() === userId;
        if (!isBuyer && !isSeller) {
          return socket.emit('error', { message: 'Accès non autorisé' });
        }

        socket.join(conversationId);
        socket.data.contacts.add(otherParticipantId(conversation, userId)); // nouvelle conversation

        // Marquer comme livrés les messages reçus mais pas encore livrés
        const undeliveredMessages = await Message.find({
          conversationId,
          senderId: { $ne: userId },
          delivered: false,
        }).select('_id senderId').lean();

        if (undeliveredMessages.length > 0) {
          const deliveredAt = new Date();
          await Message.updateMany(
            { _id: { $in: undeliveredMessages.map((msg) => msg._id) } },
            { $set: { delivered: true, deliveredAt } }
          );

          undeliveredMessages.forEach((msg) => {
            emitMessageDelivered({
              io,
              conversationId,
              messageId: msg._id.toString(),
              deliveredAt,
              recipientId: userId,
              senderId: msg.senderId.toString(),
            });
          });
        }

        socket.to(conversationId).emit('user:joined', {
          userId,
          userName: socket.userData.name
        });
      } catch (error) {
        console.error('❌ Erreur rejoindre conversation:', error);
        socket.emit('error', { message: 'Erreur lors de la connexion à la conversation' });
      }
    });

    // ===============================================
    // 📤 ENVOYER UN MESSAGE
    // ===============================================
    socket.on('message:send', async (data) => {
      try {
        const { conversationId, content, type = 'text', attachments = [], offerDetails } = data || {};

        const conversation = await Conversation.findById(conversationId)
          .populate('participants.buyer', 'name avatar')
          .populate('participants.seller', 'name avatar');

        if (!conversation) {
          return socket.emit('error', { message: 'Conversation introuvable' });
        }

        const isBuyer = conversation.participants.buyer._id.toString() === userId;
        const isSeller = conversation.participants.seller._id.toString() === userId;
        if (!isBuyer && !isSeller) {
          return socket.emit('error', { message: 'Accès non autorisé' });
        }

        const sender = isBuyer ? conversation.participants.buyer : conversation.participants.seller;
        const isPostClosure = Boolean(conversation.closedByOwner);
        const otherUserId = isBuyer
          ? conversation.participants.seller._id.toString()
          : conversation.participants.buyer._id.toString();

        // Destinataire connecté → livré dès la création (1 écriture au lieu de 2)
        const recipientOnline = await isUserOnline(io, otherUserId);
        const now = new Date();
        const deliveredAt = recipientOnline ? now : null;

        const message = await Message.create({
          conversationId,
          senderId: userId,
          senderName: sender.name,
          senderAvatar: sender.avatar,
          content,
          type,
          attachments,
          offerDetails,
          timestamp: now.toISOString(),
          read: false,
          delivered: recipientOnline,
          deliveredAt,
          postClosure: isPostClosure
        });

        await recordLastMessage(conversation, message, { isBuyer, deliveredAt, postClosure: isPostClosure });

        io.to(conversationId).emit('message:new', message.toMessageJSON());

        if (recipientOnline) {
          emitMessageDelivered({
            io,
            conversationId,
            messageId: message._id.toString(),
            deliveredAt,
            recipientId: otherUserId,
            senderId: userId,
          });
        }

        // Destinataire, même hors de la conversation : aperçu + nouveau total de non-lus
        io.to(userRoom(otherUserId)).emit('conversation:updated', {
          conversationId,
          lastMessage: conversation.lastMessage,
          unreadCount: isBuyer ? conversation.unreadCount.seller : conversation.unreadCount.buyer
        });
        emitUnreadCount(io, otherUserId);

        // Notification push en arrière-plan
        notifyRecipientNewMessage({
          recipientId: otherUserId,
          conversationId,
          senderName: sender.name,
          content,
          type,
        });
      } catch (error) {
        console.error('❌ Erreur envoi message:', error);
        socket.emit('error', { message: 'Erreur lors de l\'envoi du message' });
      }
    });

    // ===============================================
    // 👁️ MARQUER UN MESSAGE COMME LU
    // ===============================================
    // (L'app mobile utilise désormais PUT /conversations/:id/read, qui traite tous les
    //  messages en une fois ; cet événement reste pour le client web.)
    socket.on('message:read', async (data) => {
      try {
        const { messageId, conversationId } = data || {};
        if (!mongoose.Types.ObjectId.isValid(messageId)) return;

        const now = new Date();
        // Mise à jour atomique et conditionnelle : ne fait rien si déjà lu ou si c'est notre message
        const message = await Message.findOneAndUpdate(
          { _id: messageId, senderId: { $ne: userId }, read: false },
          [{ $set: { read: true, readAt: now, delivered: true, deliveredAt: { $ifNull: ['$deliveredAt', now] } } }],
          { new: true, projection: { senderId: 1, conversationId: 1, deliveredAt: 1, readAt: 1 } }
        ).lean();
        if (!message) return;

        const convId = String(message.conversationId || conversationId);
        const senderId = message.senderId.toString();

        emitMessageDelivered({
          io,
          conversationId: convId,
          messageId,
          deliveredAt: message.deliveredAt,
          recipientId: userId,
          senderId,
        });
        io.to(convId).to(userRoom(senderId)).emit('message:read', {
          conversationId: convId,
          messageId,
          readAt: message.readAt
        });

        // Compteur de non-lus et aperçu : une écriture atomique
        const conversation = await Conversation.findById(convId).select('participants lastMessage.id').lean();
        if (conversation) {
          const role = conversation.participants.buyer.toString() === userId ? 'buyer' : 'seller';
          const set = {};
          if (conversation.lastMessage?.id?.toString() === String(messageId)) {
            Object.assign(set, {
              'lastMessage.delivered': true,
              'lastMessage.deliveredAt': message.deliveredAt,
              'lastMessage.read': true,
              'lastMessage.readAt': message.readAt,
            });
          }
          await Conversation.updateOne(
            { _id: convId, [`unreadCount.${role}`]: { $gt: 0 } },
            { $inc: { [`unreadCount.${role}`]: -1 }, ...(Object.keys(set).length ? { $set: set } : {}) },
            { timestamps: false }
          );
          emitUnreadCount(io, userId);
        }
      } catch (error) {
        console.error('❌ Erreur marquage message:', error);
        socket.emit('error', { message: 'Erreur lors du marquage du message' });
      }
    });

    // ===============================================
    // ✍️ UTILISATEUR EN TRAIN DE TAPER
    // ===============================================
    socket.on('typing:start', (data) => {
      const { conversationId, type } = data || {};
      if (!conversationId) return;
      socket.to(conversationId).emit('typing:start', {
        userId,
        userName: socket.userData.name,
        conversationId,
        type: type || 'text',
      });
    });

    socket.on('typing:stop', (data) => {
      const { conversationId } = data || {};
      if (!conversationId) return;
      socket.to(conversationId).emit('typing:stop', {
        userId,
        userName: socket.userData.name,
        conversationId
      });
    });

    // ===============================================
    // 🚪 QUITTER UNE CONVERSATION
    // ===============================================
    socket.on('conversation:leave', (data) => {
      const { conversationId } = data || {};
      if (!conversationId) return;

      socket.leave(conversationId);
      socket.to(conversationId).emit('user:left', {
        userId,
        userName: socket.userData.name
      });
    });

    // ===============================================
    // ❌ DÉCONNEXION
    // ===============================================
    socket.on('disconnect', async () => {
      try {
        // Hors ligne seulement quand le dernier appareil se déconnecte — et seuls ses contacts sont prévenus
        if (!socket.data.contacts?.size) return;
        if (await isUserOnline(io, userId)) return;
        io.to(contactRooms(socket.data.contacts)).emit('user:offline', { userId });
      } catch (error) {
        console.error('⚠️ Erreur présence (déconnexion):', error.message);
      }
    });

    // ===============================================
    // 🔄 HEARTBEAT pour maintenir la connexion
    // ===============================================
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  // Utilitaires exposés aux contrôleurs HTTP
  return {
    isUserOnline: (userId) => isUserOnline(io, userId), // asynchrone
  };
};

module.exports = setupSocketHandlers;
