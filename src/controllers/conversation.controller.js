const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Product = require('../models/Product');
const User = require('../models/User');
const { sendExpoPushNotifications } = require('../utils/expoNotifications');

const DEAL_STATUS = {
  OPEN: 'open',
  PENDING: 'pending_conclusion',
  CONCLUDED: 'concluded',
  NOT_CONCLUDED: 'not_concluded',
};

const emitConversationUpdate = async (req, conversation, userId) => {
  const io = req.app.get('io');
  const socketUtils = req.app.get('socketUtils');

  if (!io || !socketUtils) return;

  try {
    const connectedUsers = socketUtils.getConnectedUsers();
    const payload = {
      conversationId: conversation._id.toString(),
      lastMessage: conversation.lastMessage,
      unreadCount: conversation.participants?.buyer?.toString() === userId
        ? conversation.unreadCount.buyer
        : conversation.unreadCount.seller,
      status: conversation.status,
      deal: {
        status: conversation.deal?.status || DEAL_STATUS.OPEN,
        requestedBy: conversation.deal?.requestedBy ? conversation.deal.requestedBy.toString() : null,
        requestedAt: conversation.deal?.requestedAt || null,
        resolvedBy: conversation.deal?.resolvedBy ? conversation.deal.resolvedBy.toString() : null,
        resolvedAt: conversation.deal?.resolvedAt || null,
        note: conversation.deal?.note || ''
      }
    };

    const recipients = [conversation.participants.buyer, conversation.participants.seller]
      .map((participant) => participant?.toString())
      .filter(Boolean);

    recipients.forEach((recipientId) => {
      if (connectedUsers && connectedUsers.has(recipientId)) {
        connectedUsers.get(recipientId).forEach((socketId) => {
          io.to(socketId).emit('conversation:updated', payload);
        });
      }
    });
  } catch (error) {
    console.error('⚠️ Erreur emission conversation:updated:', error.message);
  }
};

const adjustSellerDealCount = async (conversation, delta) => {
  if (!delta) return;

  const sellerId = conversation?.participants?.seller;
  if (!sellerId) return;

  await User.updateOne(
    { _id: sellerId },
    {
      $inc: { 'sellerStats.dealsConcluded': delta },
    }
  );
};

const buildDealNotification = (actionName, conversation, actorUserId) => {
  const actorName = conversation?.participants?.buyer?._id?.toString() === actorUserId
    ? conversation?.participants?.buyer?.name || 'Un utilisateur'
    : conversation?.participants?.seller?.name || 'Un utilisateur';

  const itemTitle = conversation?.item?.title ? ` pour "${conversation.item.title}"` : '';

  if (actionName === 'request' || actionName === 'start') {
    return {
      recipientId: conversation?.participants?.buyer?._id?.toString() || null,
      title: 'Nouvelle demande de clôture',
      body: `${actorName} a demandé la clôture${itemTitle}.`,
    };
  }

  if (actionName === 'confirm') {
    return {
      recipientId: conversation?.participants?.seller?._id?.toString() || null,
      title: 'Clôture validée',
      body: `${actorName} a validé la clôture${itemTitle}.`,
    };
  }

  if (actionName === 'decline') {
    return {
      recipientId: conversation?.participants?.seller?._id?.toString() || null,
      title: 'Clôture refusée',
      body: `${actorName} a refusé la clôture${itemTitle}.`,
    };
  }

  if (actionName === 'reopen') {
    return {
      recipientId: conversation?.participants?.buyer?._id?.toString() || null,
      title: 'Conversation rouverte',
      body: `${actorName} a rouvert la conversation${itemTitle}.`,
    };
  }

  return null;
};

// ===============================================
// 📋 OBTENIR TOUTES LES CONVERSATIONS D'UN UTILISATEUR
// ===============================================
// @desc    Récupérer toutes les conversations de l'utilisateur connecté
// @route   GET /api/conversations
// @access  Private
exports.getConversations = async (req, res) => {
  try {
    console.log({ id: req.user.id });
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

    // Resynchroniser l'etat de lecture du dernier message avec la source de verite (collection Message).
    const lastMessageIds = conversations
      .map((conv) => conv?.lastMessage?.id)
      .filter(Boolean)
      .map((id) => id.toString());

    let readByMessageId = new Map();
    if (lastMessageIds.length > 0) {
      const lastMessages = await Message.find({ _id: { $in: lastMessageIds } })
        .select('_id read');

      readByMessageId = new Map(
        lastMessages.map((msg) => [msg._id.toString(), Boolean(msg.read)])
      );
    }

    conversations.forEach((conv) => {
      const lastId = conv?.lastMessage?.id ? conv.lastMessage.id.toString() : '';
      if (!lastId || !readByMessageId.has(lastId)) return;
      conv.lastMessage.read = readByMessageId.get(lastId);
    });

    // Ignorer les conversations orphelines (participant supprimé => populate null)
    const validConversations = conversations.filter(
      (conv) => conv?.participants?.buyer && conv?.participants?.seller
    );

    const orphanCount = conversations.length - validConversations.length;
    if (orphanCount > 0) {
      console.warn(`⚠️ ${orphanCount} conversation(s) ignorée(s) car participant manquant`);
    }

    console.log(`✅ ${validConversations.length} conversation(s) valide(s) trouvée(s)`);

    // Transformer en format frontend
    const conversationsJSON = await Promise.all(
      validConversations.map((conv) => conv.toConversationJSON(userId))
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

    // Conversation orpheline: un participant a été supprimé
    if (!conversation.participants?.buyer || !conversation.participants?.seller) {
      return res.status(404).json({
        success: false,
        message: 'Conversation introuvable (participant manquant)'
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

    // Garder la conversation synchronisee pour l'affichage liste apres refresh.
    if (
      conversation.lastMessage?.id &&
      conversation.lastMessage?.senderId &&
      conversation.lastMessage.senderId.toString() !== userId
    ) {
      conversation.lastMessage.read = true;
      await conversation.save();
    }

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
// 🤝 METTRE À JOUR LE STATUT D'AFFAIRE
// ===============================================
// @route   PUT /api/conversations/:id/deal
// @access  Private

// ===============================================
// 🤝 METTRE À JOUR L'ÉTAT DE CONCLUSION D'UNE CONVERSATION
// ===============================================
// @route   PUT /api/conversations/:id/deal
// @access  Private
exports.updateConversationDeal = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, note } = req.body || {};
    const userId = req.user.id;

    const conversation = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar')
      .populate('participants.seller', 'name avatar');

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation introuvable' });
    }

    const isBuyer = conversation.participants.buyer?._id?.toString() === userId;
    const isSeller = conversation.participants.seller?._id?.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    const currentStatus = conversation.deal?.status || DEAL_STATUS.OPEN;
    const actionName = String(action || '').trim();
    const now = new Date();
    const previousStatus = currentStatus;

    if ((actionName === 'request' || actionName === 'start') && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Seul le posteur peut demander la clôture'
      });
    }

    if ((actionName === 'confirm' || actionName === 'decline') && !isBuyer) {
      return res.status(403).json({
        success: false,
        message: 'Seul le client peut valider ou refuser la demande'
      });
    }

    if (actionName === 'reopen' && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'Seul le posteur peut rouvrir la conversation'
      });
    }

    if (actionName === 'request' || actionName === 'start') {
      if (currentStatus === DEAL_STATUS.CONCLUDED) {
        return res.status(400).json({ success: false, message: 'Cette affaire est déjà conclue' });
      }

      conversation.deal = {
        status: DEAL_STATUS.PENDING,
        requestedBy: userId,
        requestedAt: now,
        resolvedBy: null,
        resolvedAt: null,
        note: String(note || '').trim(),
      };
    } else if (actionName === 'confirm') {
      if (currentStatus !== DEAL_STATUS.PENDING) {
        return res.status(400).json({ success: false, message: 'Aucune demande de clôture en attente' });
      }

      if (String(conversation.deal?.requestedBy || '') === String(userId)) {
        return res.status(400).json({ success: false, message: 'Le demandeur ne peut pas confirmer sa propre demande' });
      }

      conversation.deal = {
        status: DEAL_STATUS.CONCLUDED,
        requestedBy: conversation.deal?.requestedBy || null,
        requestedAt: conversation.deal?.requestedAt || null,
        resolvedBy: userId,
        resolvedAt: now,
        note: String(note || conversation.deal?.note || '').trim(),
      };

      if (previousStatus !== DEAL_STATUS.CONCLUDED) {
        await adjustSellerDealCount(conversation, 1);
      }
    } else if (actionName === 'decline') {
      if (currentStatus !== DEAL_STATUS.PENDING) {
        return res.status(400).json({ success: false, message: 'Aucune demande de clôture en attente' });
      }

      conversation.deal = {
        status: DEAL_STATUS.NOT_CONCLUDED,
        requestedBy: conversation.deal?.requestedBy || null,
        requestedAt: conversation.deal?.requestedAt || null,
        resolvedBy: userId,
        resolvedAt: now,
        note: String(note || '').trim(),
      };
    } else if (actionName === 'reopen') {
      if (previousStatus === DEAL_STATUS.CONCLUDED) {
        await adjustSellerDealCount(conversation, -1);
      }

      conversation.deal = {
        status: DEAL_STATUS.OPEN,
        requestedBy: null,
        requestedAt: null,
        resolvedBy: null,
        resolvedAt: null,
        note: '',
      };
    } else {
      return res.status(400).json({ success: false, message: 'Action invalide' });
    }

    conversation.markModified('deal');
    await conversation.save();

    await emitConversationUpdate(req, conversation, userId);

    const notification = buildDealNotification(actionName, conversation, userId);
    if (notification?.recipientId) {
      try {
        const recipient = await User.findById(notification.recipientId).select('expoPushTokens name');
        const tokens = Array.isArray(recipient?.expoPushTokens) ? recipient.expoPushTokens : [];

        await sendExpoPushNotifications({
          tokens,
          title: notification.title,
          body: notification.body,
          data: {
            type: 'conversation_deal_update',
            conversationId: conversation._id.toString(),
            action: actionName,
            dealStatus: conversation.deal?.status || DEAL_STATUS.OPEN
          }
        });
      } catch (pushError) {
        console.error('⚠️ Erreur envoi notification push:', pushError.message);
      }
    }

    const refreshed = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status');

    return res.status(200).json({
      success: true,
      message: 'Statut de l\'affaire mis à jour',
      data: await refreshed.toConversationJSON(userId),
    });
  } catch (error) {
    console.error('❌ Erreur mise à jour statut affaire:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du statut de l\'affaire',
      error: error.message,
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
