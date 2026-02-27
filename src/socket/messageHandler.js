const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

// Map pour stocker les utilisateurs connectés
// Format: { userId: Set of socketIds }
const connectedUsers = new Map();

/**
 * Configuration du gestionnaire Socket.IO pour la messagerie temps réel
 */
const setupSocketHandlers = (io) => {
  // Middleware d'authentification Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      console.log('🔐 Tentative d\'authentification Socket.IO...');
      
      if (!token) {
        console.error('❌ Token manquant dans handshake');
        return next(new Error('Token manquant'));
      }

      console.log('🔑 Token reçu:', token.substring(0, 20) + '...');

      // Vérifier le token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      console.log('✅ Token valide pour utilisateur:', decoded.id);
      
      // Récupérer l'utilisateur
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        console.error('❌ Utilisateur introuvable:', decoded.id);
        return next(new Error('Utilisateur introuvable'));
      }

      console.log('✅ Utilisateur trouvé:', user.name);

      socket.userId = user._id.toString();
      socket.userData = {
        id: user._id.toString(),
        name: user.name,
        avatar: user.avatar
      };

      next();
    } catch (error) {
      console.error('❌ Erreur authentification Socket:', error.message);
      next(new Error('Authentification échouée: ' + error.message));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log('✅ Utilisateur connecté:', userId, 'Socket:', socket.id);

    // Ajouter l'utilisateur à la map des connectés
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    // Envoyer la liste des utilisateurs actuellement en ligne au client qui vient de se connecter
    const onlineUserIds = Array.from(connectedUsers.keys()).filter(id => id !== userId);
    socket.emit('users:online', { userIds: onlineUserIds });
    console.log('📋 Liste utilisateurs en ligne envoyée à', userId, ':', onlineUserIds.length, 'utilisateurs');

    // Informer les autres que cet utilisateur est en ligne
    socket.broadcast.emit('user:online', { userId });

    // ===============================================
    // 🏠 REJOINDRE UNE CONVERSATION
    // ===============================================
    socket.on('conversation:join', async (data) => {
      try {
        const { conversationId } = data;
        console.log(`📥 ${userId} rejoint conversation:`, conversationId);

        // Vérifier que la conversation existe et que l'utilisateur y participe
        const conversation = await Conversation.findById(conversationId);
        
        if (!conversation) {
          return socket.emit('error', { message: 'Conversation introuvable' });
        }

        const isBuyer = conversation.participants.buyer.toString() === userId;
        const isSeller = conversation.participants.seller.toString() === userId;

        if (!isBuyer && !isSeller) {
          return socket.emit('error', { message: 'Accès non autorisé' });
        }

        // Rejoindre la room de la conversation
        socket.join(conversationId);
        console.log(`✅ ${userId} a rejoint la room:`, conversationId);

        // Notifier l'autre participant que l'utilisateur a rejoint
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
        const { conversationId, content, type = 'text', attachments = [], offerDetails } = data;
        console.log(`📤 ${userId} envoie message dans:`, conversationId);

        // Vérifier la conversation
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

        // Créer le message dans la BD
        const sender = isBuyer ? conversation.participants.buyer : conversation.participants.seller;
        const message = await Message.create({
          conversationId,
          senderId: userId,
          senderName: sender.name,
          senderAvatar: sender.avatar,
          content,
          type,
          attachments,
          offerDetails,
          timestamp: new Date().toISOString(),
          read: false
        });

        // Mettre à jour la conversation
        conversation.lastMessage = {
          id: message._id,
          content: message.content,
          senderId: message.senderId.toString(),
          senderName: message.senderName,
          timestamp: message.timestamp,
          read: false,
          type: message.type
        };

        // Incrémenter le compteur de non-lus pour le destinataire
        if (isBuyer) {
          conversation.unreadCount.seller += 1;
        } else {
          conversation.unreadCount.buyer += 1;
        }

        conversation.updatedAt = new Date();
        await conversation.save();

        const messageJSON = message.toMessageJSON();

        console.log(`✅ Message créé:`, { id: messageJSON.id, senderId: messageJSON.senderId, read: messageJSON.read });

        // Envoyer le message à tous les participants de la conversation
        io.to(conversationId).emit('message:new', messageJSON);

        // Envoyer une notification à l'autre participant s'il n'est pas dans la conversation
        const otherUserId = isBuyer 
          ? conversation.participants.seller._id.toString()
          : conversation.participants.buyer._id.toString();

        // Notifier l'autre utilisateur même s'il n'est pas dans la room
        if (connectedUsers.has(otherUserId)) {
          const otherUserSockets = connectedUsers.get(otherUserId);
          otherUserSockets.forEach(socketId => {
            io.to(socketId).emit('conversation:updated', {
              conversationId,
              lastMessage: conversation.lastMessage,
              unreadCount: isBuyer ? conversation.unreadCount.seller : conversation.unreadCount.buyer
            });
            // Notifier du changement du compteur global
            io.to(socketId).emit('unreadCount:changed');
          });
        }

        console.log('✅ Message envoyé:', message._id);

      } catch (error) {
        console.error('❌ Erreur envoi message:', error);
        socket.emit('error', { message: 'Erreur lors de l\'envoi du message' });
      }
    });

    // ===============================================
    // 👁️ MARQUER COMME LU
    // ===============================================
    socket.on('message:read', async (data) => {
      try {
        const { messageId, conversationId } = data;
        console.log(`👁️ ${userId} marque message comme lu:`, messageId);

        const message = await Message.findById(messageId);

        if (!message) {
          return socket.emit('error', { message: 'Message introuvable' });
        }

        // Ne peut marquer comme lu que si on n'est pas l'expéditeur
        if (message.senderId.toString() === userId) {
          return;
        }

        await message.markAsRead();

        // Notifier tous les participants de la conversation (y compris l'expéditeur)
        console.log(`📢 Émission de message:read pour conversation ${conversationId}, message ${messageId}`);
        io.to(conversationId).emit('message:read', {
          conversationId,
          messageId,
          readAt: message.readAt
        });

        // Notifier aussi directement l'expéditeur du message s'il est connecté
        const senderId = message.senderId.toString();
        if (connectedUsers.has(senderId)) {
          const senderSockets = connectedUsers.get(senderId);
          console.log(`📢 Notification directe à l'expéditeur ${senderId} (${senderSockets.size} sockets)`);
          senderSockets.forEach(socketId => {
            io.to(socketId).emit('message:read', {
              conversationId,
              messageId,
              readAt: message.readAt
            });
          });
        }

        // Décrémenter le compteur de non-lus dans la conversation
        const conversation = await Conversation.findById(conversationId);
        if (conversation) {
          const isBuyer = conversation.participants.buyer.toString() === userId;
          
          if (isBuyer && conversation.unreadCount.buyer > 0) {
            conversation.unreadCount.buyer -= 1;
          } else if (!isBuyer && conversation.unreadCount.seller > 0) {
            conversation.unreadCount.seller -= 1;
          }
          
          await conversation.save();

          // Notifier l'utilisateur du changement du compteur global
          if (connectedUsers.has(userId)) {
            const userSockets = connectedUsers.get(userId);
            userSockets.forEach(socketId => {
              io.to(socketId).emit('unreadCount:changed');
            });
          }
        }

        console.log('✅ Message marqué comme lu');

      } catch (error) {
        console.error('❌ Erreur marquage message:', error);
        socket.emit('error', { message: 'Erreur lors du marquage du message' });
      }
    });

    // ===============================================
    // ✍️ UTILISATEUR EN TRAIN DE TAPER
    // ===============================================
    socket.on('typing:start', (data) => {
      const { conversationId } = data;
      console.log(`✍️ ${userId} commence à taper dans:`, conversationId);
      socket.to(conversationId).emit('typing:start', {
        userId,
        userName: socket.userData.name,
        conversationId
      });
    });

    socket.on('typing:stop', (data) => {
      const { conversationId } = data;
      console.log(`✍️ ${userId} arrête de taper dans:`, conversationId);
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
      const { conversationId } = data;
      console.log(`🚪 ${userId} quitte conversation:`, conversationId);
      
      socket.leave(conversationId);
      
      socket.to(conversationId).emit('user:left', {
        userId,
        userName: socket.userData.name
      });
    });

    // ===============================================
    // ❌ DÉCONNEXION
    // ===============================================
    socket.on('disconnect', (reason) => {
      console.log('❌ Utilisateur déconnecté:', userId, 'Socket:', socket.id, 'Raison:', reason);

      // Retirer le socket de la map
      if (connectedUsers.has(userId)) {
        const userSockets = connectedUsers.get(userId);
        userSockets.delete(socket.id);
        
        // Si l'utilisateur n'a plus de sockets connectés, le retirer complètement
        if (userSockets.size === 0) {
          connectedUsers.delete(userId);
          // Informer les autres que l'utilisateur est hors ligne
          socket.broadcast.emit('user:offline', { userId });
        }
      }
    });

    // ===============================================
    // 🔄 HEARTBEAT pour maintenir la connexion
    // ===============================================
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  // Retourner les utilisateurs connectés (utile pour le debug)
  return {
    getConnectedUsers: () => {
      return connectedUsers; // Retourner la Map complète
    },
    getConnectedUserIds: () => {
      return Array.from(connectedUsers.keys());
    },
    isUserOnline: (userId) => {
      return connectedUsers.has(userId);
    }
  };
};

module.exports = setupSocketHandlers;
