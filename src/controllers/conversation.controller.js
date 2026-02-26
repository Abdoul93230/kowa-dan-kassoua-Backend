const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Product = require('../models/Product');

// ===============================================
// 📋 OBTENIR TOUTES LES CONVERSATIONS D'UN UTILISATEUR
// ===============================================
// @desc    Récupérer toutes les conversations de l'utilisateur connecté
// @route   GET /api/conversations
// @access  Private
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('📋 Récupération des conversations pour l\'utilisateur:', userId);

    // Trouver toutes les conversations où l'utilisateur est participant
    const conversations = await Conversation.find({
      $or: [
        { 'participants.buyer': userId },
        { 'participants.seller': userId }
      ],
      status: 'active'
    })
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status')
      .sort({ updatedAt: -1 });

    console.log(`✅ ${conversations.length} conversation(s) trouvée(s)`);

    // Transformer en format frontend
    const conversationsJSON = await Promise.all(
      conversations.map(conv => conv.toConversationJSON(userId))
    );

    res.status(200).json({
      success: true,
      data: conversationsJSON
    });

  } catch (error) {
    console.error('❌ Erreur récupération conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des conversations',
      error: error.message
    });
  }
};

// ===============================================
// 🔍 OBTENIR UNE CONVERSATION SPÉCIFIQUE
// ===============================================
// @desc    Récupérer une conversation par son ID
// @route   GET /api/conversations/:id
// @access  Private
exports.getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('🔍 Récupération conversation:', id);

    const conversation = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status');

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    // Vérifier que l'utilisateur est participant
    const isBuyer = conversation.participants.buyer._id.toString() === userId;
    const isSeller = conversation.participants.seller._id.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette conversation'
      });
    }

    console.log('✅ Conversation trouvée');

    res.status(200).json({
      success: true,
      data: await conversation.toConversationJSON(userId)
    });

  } catch (error) {
    console.error('❌ Erreur récupération conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la conversation',
      error: error.message
    });
  }
};

// ===============================================
// ➕ CRÉER OU RÉCUPÉRER UNE CONVERSATION
// ===============================================
// @desc    Créer une nouvelle conversation ou récupérer une existante
// @route   POST /api/conversations
// @access  Private
exports.createOrGetConversation = async (req, res) => {
  try {
    const { sellerId, productId } = req.body;
    const buyerId = req.user.id;

    console.log('➕ Création/récupération conversation:', { buyerId, sellerId, productId });

    // Validation
    if (!sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Le vendeur est obligatoire'
      });
    }

    // Éviter qu'un vendeur se contacte lui-même
    if (buyerId === sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas vous envoyer de message à vous-même'
      });
    }

    // Vérifier si une conversation existe déjà
    const query = {
      'participants.buyer': buyerId,
      'participants.seller': sellerId
    };

    if (productId) {
      query['item.id'] = productId;
    }

    let conversation = await Conversation.findOne(query)
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status');

    // Si la conversation existe, la retourner
    if (conversation) {
      console.log('✅ Conversation existante trouvée');
      return res.status(200).json({
        success: true,
        data: await conversation.toConversationJSON(buyerId),
        existing: true
      });
    }

    // Sinon, créer une nouvelle conversation
    console.log('📝 Création d\'une nouvelle conversation...');

    const conversationData = {
      participants: {
        buyer: buyerId,
        seller: sellerId
      },
      status: 'active'
    };

    // Ajouter les informations du produit si fourni
    if (productId) {
      const product = await Product.findById(productId);
      if (product) {
        conversationData.item = {
          id: product._id,
          title: product.title,
          image: product.mainImage,
          price: product.price
        };
      }
    }

    conversation = await Conversation.create(conversationData);

    // Populate les champs
    conversation = await Conversation.findById(conversation._id)
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status');

    // Créer un message de bienvenue automatique du vendeur
    if (conversation.item && conversation.item.title) {
      const sellerUser = await conversation.participants.seller.populate('name avatar');
      const welcomeMessage = await Message.create({
        conversationId: conversation._id,
        senderId: sellerId,
        senderName: conversation.participants.seller.name,
        senderAvatar: conversation.participants.seller.avatar,
        content: `Bonjour ! Je vois que vous êtes intéressé(e) par "${conversation.item.title}". N'hésitez pas à me poser vos questions ! 😊`,
        type: 'text',
        read: false
      });

      // Mettre à jour le dernier message
      conversation.lastMessage = {
        id: welcomeMessage._id,
        content: welcomeMessage.content,
        senderId: welcomeMessage.senderId.toString(),
        senderName: welcomeMessage.senderName,
        timestamp: welcomeMessage.timestamp,
        read: false,
        type: 'text'
      };
      conversation.unreadCount.buyer = 1;
      await conversation.save();
    }

    console.log('✅ Nouvelle conversation créée:', conversation._id);

    res.status(201).json({
      success: true,
      data: await conversation.toConversationJSON(buyerId),
      existing: false
    });

  } catch (error) {
    console.error('❌ Erreur création conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la conversation',
      error: error.message
    });
  }
};

// ===============================================
// ✅ MARQUER UNE CONVERSATION COMME LUE
// ===============================================
// @desc    Marquer tous les messages d'une conversation comme lus
// @route   PUT /api/conversations/:id/read
// @access  Private
exports.markConversationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('✅ Marquage conversation comme lue:', id);

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    // Déterminer si l'utilisateur est acheteur ou vendeur
    const isBuyer = conversation.participants.buyer.toString() === userId;
    const isSeller = conversation.participants.seller.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    // Réinitialiser le compteur de non-lus pour cet utilisateur
    if (isBuyer) {
      conversation.unreadCount.buyer = 0;
    } else {
      conversation.unreadCount.seller = 0;
    }

    await conversation.save();

    // Récupérer les messages qui vont être marqués comme lus pour notifier leurs expéditeurs
    const messagesToMarkAsRead = await Message.find({
      conversationId: id,
      senderId: { $ne: userId },
      read: false
    });

    console.log(`📨 ${messagesToMarkAsRead.length} message(s) à marquer comme lu`);

    // Marquer tous les messages non-lus de cette conversation comme lus
    await Message.updateMany(
      {
        conversationId: id,
        senderId: { $ne: userId },
        read: false
      },
      {
        $set: { read: true, readAt: new Date() }
      }
    );

    // Notifier via Socket.IO du changement du compteur de non-lus
    const io = req.app.get('io');
    const socketUtils = req.app.get('socketUtils');
    if (io && socketUtils) {
      try {
        const connectedUsers = socketUtils.getConnectedUsers();
        
        // Notifier l'utilisateur actuel du changement de compteur
        if (connectedUsers && connectedUsers.has && connectedUsers.has(userId)) {
          const userSockets = connectedUsers.get(userId);
          if (userSockets) {
            userSockets.forEach(socketId => {
              io.to(socketId).emit('unreadCount:changed');
            });
          }
        }

        // Notifier les expéditeurs que leurs messages ont été lus
        messagesToMarkAsRead.forEach(msg => {
          const senderId = msg.senderId.toString();
          console.log(`📢 Notification message:read pour ${msg._id} à l'expéditeur ${senderId}`);
          
          // Émettre à la room de la conversation
          io.to(id).emit('message:read', {
            conversationId: id,
            messageId: msg._id.toString(),
            readAt: new Date()
          });

          // Émettre aussi directement à l'expéditeur
          if (connectedUsers.has(senderId)) {
            const senderSockets = connectedUsers.get(senderId);
            senderSockets.forEach(socketId => {
              io.to(socketId).emit('message:read', {
                conversationId: id,
                messageId: msg._id.toString(),
                readAt: new Date()
              });
            });
          }
        });
      } catch (socketError) {
        console.error('⚠️ Erreur notification Socket.IO:', socketError.message);
        // Ne pas faire échouer la requête si Socket.IO a un problème
      }
    }

    console.log('✅ Conversation marquée comme lue');

    res.status(200).json({
      success: true,
      message: 'Conversation marquée comme lue'
    });

  } catch (error) {
    console.error('❌ Erreur marquage conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage de la conversation',
      error: error.message
    });
  }
};

// ===============================================
// 🗑️ ARCHIVER UNE CONVERSATION
// ===============================================
// @desc    Archiver une conversation
// @route   DELETE /api/conversations/:id
// @access  Private
exports.archiveConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('🗑️ Archivage conversation:', id);

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable'
      });
    }

    // Vérifier que l'utilisateur est participant
    const isBuyer = conversation.participants.buyer.toString() === userId;
    const isSeller = conversation.participants.seller.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    conversation.status = 'archived';
    await conversation.save();

    console.log('✅ Conversation archivée');

    res.status(200).json({
      success: true,
      message: 'Conversation archivée'
    });

  } catch (error) {
    console.error('❌ Erreur archivage conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'archivage de la conversation',
      error: error.message
    });
  }
};

// ===============================================
// 📊 OBTENIR LE NOMBRE TOTAL DE MESSAGES NON LUS
// ===============================================
// @desc    Obtenir le nombre total de messages non lus pour l'utilisateur
// @route   GET /api/conversations/unread/count
// @access  Private
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.find({
      $or: [
        { 'participants.buyer': userId },
        { 'participants.seller': userId }
      ],
      status: 'active'
    });

    let totalUnread = 0;
    conversations.forEach(conv => {
      const isBuyer = conv.participants.buyer.toString() === userId;
      totalUnread += isBuyer ? conv.unreadCount.buyer : conv.unreadCount.seller;
    });

    console.log('📊 Compteur messages non lus pour', userId, ':', totalUnread);

    res.status(200).json({
      success: true,
      data: { unreadCount: totalUnread }
    });

  } catch (error) {
    console.error('❌ Erreur comptage messages non lus:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du comptage des messages non lus',
      error: error.message
    });
  }
};
