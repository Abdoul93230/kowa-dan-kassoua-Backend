const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { uploadAudio } = require('../utils/uploadAudio');

// ===============================================
// 📋 OBTENIR LES MESSAGES D'UNE CONVERSATION
// ===============================================
// @desc    Récupérer tous les messages d'une conversation
// @route   GET /api/messages/:conversationId
// @access  Private
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;

    console.log('📋 Récupération messages conversation:', conversationId);

    // Vérifier que la conversation existe et que l'utilisateur y participe
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    const isBuyer = conversation.participants.buyer.toString() === userId;
    const isSeller = conversation.participants.seller.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette conversation'
      });
    }

    // Récupérer les messages avec pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [messages, total] = await Promise.all([
      Message.find({ conversationId })
        .sort({ createdAt: 1 }) // Ordre chronologique
        .skip(skip)
        .limit(parseInt(limit))
        .populate('senderId', 'name avatar'),
      Message.countDocuments({ conversationId })
    ]);

    console.log(`✅ ${messages.length} message(s) trouvé(s)`);

    // Transformer en format frontend
    const messagesJSON = messages.map(msg => msg.toMessageJSON());

    res.status(200).json({
      success: true,
      data: messagesJSON,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération messages:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des messages',
      error: error.message
    });
  }
};

// ===============================================
// ➕ ENVOYER UN MESSAGE
// ===============================================
// @desc    Envoyer un nouveau message dans une conversation
// @route   POST /api/messages
// @access  Private
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, content, type = 'text', attachments = [], offerDetails } = req.body;
    const userId = req.user.id;

    console.log('➕ Envoi message conversation:', conversationId);

    // Validation
    if (!conversationId || !content) {
      return res.status(400).json({
        success: false,
        message: 'La conversation et le contenu sont obligatoires'
      });
    }

    // Vérifier que la conversation existe
    const conversation = await Conversation.findById(conversationId)
      .populate('participants.buyer', 'name avatar')
      .populate('participants.seller', 'name avatar');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    // Vérifier que l'utilisateur participe
    const isBuyer = conversation.participants.buyer._id.toString() === userId;
    const isSeller = conversation.participants.seller._id.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette conversation'
      });
    }

    // Récupérer les infos de l'expéditeur
    const sender = isBuyer ? conversation.participants.buyer : conversation.participants.seller;

    // Créer le message
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

    console.log('✅ Message créé:', message._id);

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

    // Retourner le message
    res.status(201).json({
      success: true,
      data: message.toMessageJSON()
    });

  } catch (error) {
    console.error('❌ Erreur envoi message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du message',
      error: error.message
    });
  }
};

// ===============================================
// ✅ MARQUER UN MESSAGE COMME LU
// ===============================================
// @desc    Marquer un message comme lu
// @route   PUT /api/messages/:id/read
// @access  Private
exports.markMessageAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('✅ Marquage message comme lu:', id);

    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message introuvable'
      });
    }

    // Ne peut marquer comme lu que si on n'est pas l'expéditeur
    if (message.senderId.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas marquer votre propre message comme lu'
      });
    }

    await message.markAsRead();

    console.log('✅ Message marqué comme lu');

    res.status(200).json({
      success: true,
      message: 'Message marqué comme lu'
    });

  } catch (error) {
    console.error('❌ Erreur marquage message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage du message',
      error: error.message
    });
  }
};

// ===============================================
// 🗑️ SUPPRIMER UN MESSAGE
// ===============================================
// @desc    Supprimer un message (soft delete)
// @route   DELETE /api/messages/:id
// @access  Private
exports.deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('🗑️ Suppression message:', id);

    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message introuvable'
      });
    }

    // Seul l'expéditeur peut supprimer son message
    if (message.senderId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Vous ne pouvez supprimer que vos propres messages'
      });
    }

    // Soft delete : remplacer le contenu
    message.content = 'Ce message a été supprimé';
    message.type = 'deleted';
    message.attachments = [];
    await message.save();

    // Si c'était le dernier message, mettre à jour la conversation
    const conversation = await Conversation.findById(message.conversationId);
    if (conversation && conversation.lastMessage.id.toString() === id) {
      // Trouver le message précédent
      const previousMessage = await Message.findOne({
        conversationId: message.conversationId,
        _id: { $ne: id }
      }).sort({ createdAt: -1 });

      if (previousMessage) {
        conversation.lastMessage = {
          id: previousMessage._id,
          content: previousMessage.content,
          senderId: previousMessage.senderId.toString(),
          senderName: previousMessage.senderName,
          timestamp: previousMessage.timestamp,
          read: previousMessage.read,
          type: previousMessage.type
        };
      } else {
        conversation.lastMessage = {
          content: 'Ce message a été supprimé',
          senderId: userId,
          senderName: '',
          timestamp: new Date().toISOString(),
          read: true,
          type: 'deleted'
        };
      }
      await conversation.save();
    }

    console.log('✅ Message supprimé');

    res.status(200).json({
      success: true,
      message: 'Message supprimé'
    });

  } catch (error) {
    console.error('❌ Erreur suppression message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du message',
      error: error.message
    });
  }
};

// ===============================================
// 🔍 RECHERCHER DANS LES MESSAGES
// ===============================================
// @desc    Rechercher dans les messages d'une conversation
// @route   GET /api/messages/search/:conversationId
// @access  Private
exports.searchMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { query } = req.query;
    const userId = req.user.id;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'La requête de recherche est obligatoire'
      });
    }

    console.log('🔍 Recherche messages:', query);

    // Vérifier l'accès à la conversation
    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    const isBuyer = conversation.participants.buyer.toString() === userId;
    const isSeller = conversation.participants.seller.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    // Rechercher les messages
    const messages = await Message.find({
      conversationId,
      content: { $regex: query, $options: 'i' },
      type: { $ne: 'deleted' }
    }).sort({ createdAt: -1 });

    console.log(`✅ ${messages.length} message(s) trouvé(s)`);

    res.status(200).json({
      success: true,
      data: messages.map(msg => msg.toMessageJSON())
    });

  } catch (error) {
    console.error('❌ Erreur recherche messages:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la recherche des messages',
      error: error.message
    });
  }
};

// ===============================================
// 🎤 ENVOYER UN MESSAGE VOCAL
// ===============================================
// @desc    Upload audio vers Cloudinary et créer un message vocal
// @route   POST /api/messages/voice
// @access  Private
exports.sendVoiceMessage = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const userId = req.user.id;
    const audioFile = req.file;

    console.log('🎤 Envoi message vocal:', { conversationId, userId, fileSize: audioFile?.size });

    // Vérifier qu'un fichier audio est présent
    if (!audioFile) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier audio fourni'
      });
    }

    // Vérifier que la conversation existe et que l'utilisateur y participe
    const conversation = await Conversation.findById(conversationId)
      .populate('participants.buyer', 'name avatar')
      .populate('participants.seller', 'name avatar');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    const isBuyer = conversation.participants.buyer._id.toString() === userId;
    const isSeller = conversation.participants.seller._id.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette conversation'
      });
    }

    // Upload l'audio vers Cloudinary
    console.log('📤 Upload audio vers Cloudinary...');
    const { url: audioUrl, duration } = await uploadAudio(
      audioFile.buffer,
      'kowa/voice-messages',
      `voice_${conversationId}_${Date.now()}`
    );

    // Créer le message vocal
    const sender = isBuyer ? conversation.participants.buyer : conversation.participants.seller;
    const message = await Message.create({
      conversationId,
      senderId: userId,
      senderName: sender.name,
      senderAvatar: sender.avatar,
      content: '', // Pas de contenu textuel pour un message vocal
      type: 'audio',
      attachments: [audioUrl], // URL de l'audio
      timestamp: new Date().toISOString(),
      read: false
    });

    // Mettre à jour la conversation
    conversation.lastMessage = {
      id: message._id,
      content: '🎤 Message vocal',
      senderId: message.senderId.toString(),
      senderName: message.senderName,
      timestamp: message.timestamp,
      read: false,
      type: 'audio'
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

    // Émettre via Socket.IO pour notification temps réel
    const io = req.app.get('io');
    const socketUtils = req.app.get('socketUtils');
    
    if (io) {
      // Envoyer le message à tous les participants de la conversation
      io.to(conversationId).emit('message:new', messageJSON);

      // Notifier l'autre participant
      const otherUserId = isBuyer 
        ? conversation.participants.seller._id.toString()
        : conversation.participants.buyer._id.toString();

      if (socketUtils) {
        try {
          const connectedUsers = socketUtils.getConnectedUsers();
          if (connectedUsers && connectedUsers.has(otherUserId)) {
            const otherUserSockets = connectedUsers.get(otherUserId);
            otherUserSockets.forEach(socketId => {
              io.to(socketId).emit('conversation:updated', {
                conversationId,
                lastMessage: conversation.lastMessage,
                unreadCount: isBuyer ? conversation.unreadCount.seller : conversation.unreadCount.buyer
              });
              io.to(socketId).emit('unreadCount:changed');
            });
          }
        } catch (socketError) {
          console.error('⚠️ Erreur notification Socket.IO:', socketError.message);
        }
      }
    }

    console.log('✅ Message vocal envoyé:', message._id);

    res.status(201).json({
      success: true,
      message: 'Message vocal envoyé avec succès',
      data: messageJSON
    });

  } catch (error) {
    console.error('❌ Erreur envoi message vocal:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du message vocal',
      error: error.message
    });
  }
};
