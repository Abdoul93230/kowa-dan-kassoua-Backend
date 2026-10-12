const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Product = require('../models/Product');
const User = require('../models/User');
const { sendExpoPushNotifications } = require('../utils/expoNotifications');
const { userRoom, getUnreadTotal, emitUnreadCount } = require('../utils/realtime');

const DEAL_STATUS = {
  OPEN: 'open',
  PENDING: 'pending_conclusion',
  CONCLUDED: 'concluded',
  NOT_CONCLUDED: 'not_concluded',
};

const emitConversationUpdate = async (req, conversation, userId) => {
  const io = req.app.get('io');
  if (!io) return;

  try {
    const payload = {
      conversationId: conversation._id.toString(),
      lastMessage: conversation.lastMessage,
      unreadCount: conversation.participants?.buyer?.toString() === userId
        ? conversation.unreadCount.buyer
        : conversation.unreadCount.seller,
      status: conversation.status,
      closedByOwner: Boolean(conversation.closedByOwner),
      closedAt: conversation.closedAt || null,
      closedById: conversation.closedById ? conversation.closedById.toString() : null,
      deal: {
        status: conversation.deal?.status || DEAL_STATUS.OPEN,
        requestedBy: conversation.deal?.requestedBy ? conversation.deal.requestedBy.toString() : null,
        requestedAt: conversation.deal?.requestedAt || null,
        resolvedBy: conversation.deal?.resolvedBy ? conversation.deal.resolvedBy.toString() : null,
        resolvedAt: conversation.deal?.resolvedAt || null,
        note: conversation.deal?.note || ''
      }
    };

    // Rooms personnelles des deux participants (fonctionne aussi sur plusieurs serveurs)
    const rooms = [conversation.participants.buyer, conversation.participants.seller]
      .map((participant) => (participant?._id || participant)?.toString())
      .filter(Boolean)
      .map(userRoom);

    if (rooms.length) io.to(rooms).emit('conversation:updated', payload);
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

// Vérifier l'éligibilité de l'acheteur pour laisser un avis
const checkReviewEligibilityForNotification = async (productId, buyerId) => {
  try {
    const Review = require('../models/Review');

    // Vérifier si avis existe déjà
    const existingReview = await Review.findOne({
      user: buyerId,
      item: productId,
      type: 'product'
    });

    if (existingReview) {
      return { eligible: false, reason: 'Avis déjà donné' };
    }

    // Vérifier que ce n'est pas le vendeur (vérifié ailleurs mais en sécurité)
    const product = await Product.findById(productId);
    if (product?.userId?.toString() === buyerId?.toString()) {
      return { eligible: false, reason: 'Vendeur du produit' };
    }

    return { eligible: true, reason: 'Éligible' };
  } catch (error) {
    console.error('⚠️ Erreur vérification éligibilité notification:', error.message);
    return { eligible: false, reason: 'Erreur' };
  }
};

const buildOwnerClosureNotification = (actionName, conversation, actorUserId, eligibility = {}) => {
  const actorName = conversation?.participants?.seller?._id?.toString() === actorUserId
    ? conversation?.participants?.seller?.name || 'Le propriétaire'
    : conversation?.participants?.buyer?.name || 'Un utilisateur';

  const itemTitle = conversation?.item?.title ? ` pour "${conversation.item.title}"` : '';

  if (actionName === 'close') {
    const isReviewEligible = eligibility?.eligible === true;
    const notification = {
      recipientId: conversation?.participants?.buyer?._id?.toString() || null,
      title: isReviewEligible ? '📝 Donnez votre avis!' : 'Discussion clôturée',
      body: isReviewEligible
        ? `${actorName} a clôturé la discussion${itemTitle}. Vous pouvez maintenant laisser votre avis!`
        : `${actorName} a clôturé la discussion${itemTitle}. Vous pouvez continuer à discuter.`,
      data: {
        isReviewEligible,
        productId: conversation?.item?.id?.toString() || conversation?.item?.toString() || null,
      }
    };
    return notification;
  }

  if (actionName === 'reopen') {
    return {
      recipientId: conversation?.participants?.buyer?._id?.toString() || null,
      title: 'Discussion rouverte',
      body: `${actorName} a rouvert la discussion${itemTitle}.`,
    };
  }

  return null;
};

const createClosureSystemMessage = async (conversation, actorUserId, actionName) => {
  const actor = conversation?.participants?.seller?._id?.toString() === actorUserId
    ? conversation?.participants?.seller
    : conversation?.participants?.buyer;

  const content = actionName === 'close'
    ? 'Discussion clôturée'
    : 'Discussion rouverte';

  const message = await Message.create({
    conversationId: conversation._id,
    senderId: actorUserId,
    senderName: actor?.name || 'Utilisateur',
    senderAvatar: actor?.avatar || null,
    content,
    type: 'system',
    timestamp: new Date().toISOString(),
    read: false,
    delivered: false,
    postClosure: false,
  });

  return message.toMessageJSON();
};

const appendClosureHistory = async (conversation, systemMessage, actionName, actorUserId) => {
  if (!conversation || !systemMessage) return conversation;

  const actor = conversation?.participants?.seller?._id?.toString() === actorUserId
    ? conversation?.participants?.seller
    : conversation?.participants?.buyer;

  conversation.closureHistory = Array.isArray(conversation.closureHistory) ? conversation.closureHistory : [];
  conversation.closureHistory.push({
    action: actionName,
    messageId: systemMessage.id,
    content: systemMessage.content,
    timestamp: systemMessage.timestamp,
    actorId: actorUserId,
    actorName: actor?.name || 'Utilisateur',
  });

  await conversation.save();
  return conversation;
};

// ===============================================
// 📋 OBTENIR TOUTES LES CONVERSATIONS D'UN UTILISATEUR
// ===============================================
// @desc    Récupérer toutes les conversations de l'utilisateur connecté
// @route   GET /api/conversations
// @access  Private
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Pagination facultative (mobile) : ?limit=30&before=<updatedAt ISO>.
    // Sans `limit`, comportement historique : toutes les conversations (client web).
    const limitNum = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100) : null;
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = {
      $or: [
        { 'participants.buyer': userId },
        { 'participants.seller': userId }
      ],
      status: 'active'
    };
    if (before && !Number.isNaN(before.getTime())) filter.updatedAt = { $lt: before };

    const query = Conversation.find(filter)
      .select('-closureHistory')
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status')
      .sort({ updatedAt: -1 });
    if (limitNum) query.limit(limitNum + 1);

    let conversations = await query;
    const hasMore = Boolean(limitNum && conversations.length > limitNum);
    if (hasMore) conversations = conversations.slice(0, limitNum);

    // Resynchroniser l'etat de lecture du dernier message avec la source de verite (collection Message).
    const lastMessageIds = conversations
      .map((conv) => conv?.lastMessage?.id)
      .filter(Boolean)
      .map((id) => id.toString());

    let readByMessageId = new Map();
    if (lastMessageIds.length > 0) {
      const lastMessages = await Message.find({ _id: { $in: lastMessageIds } })
        .select('_id read')
        .lean();

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

    // Transformer en format frontend
    const conversationsJSON = await Promise.all(
      validConversations.map((conv) => conv.toConversationJSON(userId))
    );

    const last = conversations[conversations.length - 1];
    res.status(200).json({
      success: true,
      data: conversationsJSON,
      ...(limitNum ? {
        pagination: {
          limit: limitNum,
          hasMore,
          nextBefore: hasMore && last?.updatedAt ? last.updatedAt.toISOString() : null,
        }
      } : {})
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

    const conversation = await Conversation.findById(id)
      .select('participants unreadCount lastMessage')
      .lean();

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

    const role = isBuyer ? 'buyer' : 'seller';
    const unreadMessages = await Message.find({
      conversationId: id,
      senderId: { $ne: userId },
      read: false
    }).select('_id senderId').lean();

    // Cas le plus fréquent (on rouvre une conversation déjà lue) : aucune écriture, aucun événement
    if (unreadMessages.length === 0 && !(conversation.unreadCount?.[role] > 0)) {
      return res.status(200).json({ success: true, message: 'Conversation déjà lue' });
    }

    const now = new Date();
    if (unreadMessages.length > 0) {
      await Message.updateMany(
        { _id: { $in: unreadMessages.map((msg) => msg._id) } },
        [{ $set: { read: true, readAt: now, delivered: true, deliveredAt: { $ifNull: ['$deliveredAt', now] } } }]
      );
    }

    // Une seule écriture ciblée ; timestamps: false pour ne PAS faire remonter la conversation
    // en tête de liste simplement parce qu'elle a été lue
    const set = { [`unreadCount.${role}`]: 0 };
    const last = conversation.lastMessage;
    if (last?.id && last.senderId && last.senderId.toString() !== userId && !last.read) {
      Object.assign(set, {
        'lastMessage.read': true,
        'lastMessage.readAt': now,
        'lastMessage.delivered': true,
        'lastMessage.deliveredAt': last.deliveredAt || now,
      });
    }
    await Conversation.updateOne({ _id: id }, { $set: set }, { timestamps: false });

    // Temps réel : nouveau total de non-lus pour le lecteur, accusés de lecture pour l'expéditeur
    const io = req.app.get('io');
    if (io) {
      emitUnreadCount(io, userId);
      unreadMessages.forEach((msg) => {
        // Une seule émission par socket même s'il est dans les deux rooms
        io.to(id).to(userRoom(msg.senderId.toString())).emit('message:read', {
          conversationId: id,
          messageId: msg._id.toString(),
          readAt: now
        });
      });
    }

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
// 🔒 CLÔTURER UNE CONVERSATION PAR LE PROPRIÉTAIRE
// ===============================================
// @route   PUT /api/conversations/:id/close-owner
// @access  Private
exports.closeConversationByOwner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar')
      .populate('participants.seller', 'name avatar');

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation introuvable' });
    }

    const isSeller = conversation.participants.seller?._id?.toString() === userId;
    if (!isSeller) {
      return res.status(403).json({ success: false, message: 'Seul le propriétaire de l’article peut clôturer la discussion' });
    }

    conversation.closedByOwner = true;
    conversation.closedAt = new Date();
    conversation.closedById = userId;
    await conversation.save();

    const systemMessage = await createClosureSystemMessage(conversation, userId, 'close');
    await appendClosureHistory(conversation, systemMessage, 'close', userId);

    const refreshedConversation = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status');

    const io = req.app.get('io');
    if (io) {
      io.to(conversation._id.toString()).emit('message:new', systemMessage);
    }

    await emitConversationUpdate(req, refreshedConversation, userId);

    // Vérifier l'éligibilité de l'acheteur pour laisser un avis
    const buyerId = conversation?.participants?.buyer?._id?.toString();
    const productId = conversation?.item?.id?.toString() || conversation?.item?.toString();
    const eligibility = await checkReviewEligibilityForNotification(productId, buyerId);

    const notification = buildOwnerClosureNotification('close', conversation, userId, eligibility);
    if (notification?.recipientId) {
      try {
        const recipient = await User.findById(notification.recipientId).select('expoPushTokens name');
        const tokens = Array.isArray(recipient?.expoPushTokens) ? recipient.expoPushTokens : [];

        await sendExpoPushNotifications({
          tokens,
          title: notification.title,
          body: notification.body,
          data: {
            type: eligibility.eligible ? 'review_invitation' : 'conversation_closed',
            conversationId: conversation._id.toString(),
            closedByOwner: true,
            productId: notification.data.productId,
            isReviewEligible: eligibility.eligible,
          }
        });
      } catch (pushError) {
        console.error('⚠️ Erreur envoi notification clôture:', pushError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation clôturée',
      data: await refreshedConversation.toConversationJSON(userId),
    });
  } catch (error) {
    console.error('❌ Erreur clôture conversation:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la clôture de la conversation',
      error: error.message,
    });
  }
};

// ===============================================
// 🔓 ROUVRIR UNE CONVERSATION PAR LE PROPRIÉTAIRE
// ===============================================
// @route   PUT /api/conversations/:id/reopen-owner
// @access  Private
exports.reopenConversationByOwner = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar')
      .populate('participants.seller', 'name avatar');

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation introuvable' });
    }

    const isSeller = conversation.participants.seller?._id?.toString() === userId;
    if (!isSeller) {
      return res.status(403).json({ success: false, message: 'Seul le propriétaire de l’article peut rouvrir la discussion' });
    }

    conversation.closedByOwner = false;
    conversation.closedAt = null;
    conversation.closedById = null;
    await conversation.save();

    const systemMessage = await createClosureSystemMessage(conversation, userId, 'reopen');
    await appendClosureHistory(conversation, systemMessage, 'reopen', userId);

    const refreshedConversation = await Conversation.findById(id)
      .populate('participants.buyer', 'name avatar phone email')
      .populate('participants.seller', 'name avatar phone email location rating totalReviews verified businessType')
      .populate('item.id', 'title mainImage price status');

    const io = req.app.get('io');
    if (io) {
      io.to(conversation._id.toString()).emit('message:new', systemMessage);
    }

    await emitConversationUpdate(req, refreshedConversation, userId);

    const notification = buildOwnerClosureNotification('reopen', conversation, userId);
    if (notification?.recipientId) {
      try {
        const recipient = await User.findById(notification.recipientId).select('expoPushTokens name');
        const tokens = Array.isArray(recipient?.expoPushTokens) ? recipient.expoPushTokens : [];

        await sendExpoPushNotifications({
          tokens,
          title: notification.title,
          body: notification.body,
          data: {
            type: 'conversation_reopened',
            conversationId: conversation._id.toString(),
            closedByOwner: false,
          }
        });
      } catch (pushError) {
        console.error('⚠️ Erreur envoi notification réouverture:', pushError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation rouverte',
      data: await refreshedConversation.toConversationJSON(userId),
    });
  } catch (error) {
    console.error('❌ Erreur réouverture conversation:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la réouverture de la conversation',
      error: error.message,
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
    const totalUnread = await getUnreadTotal(req.user.id);

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
