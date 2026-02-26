const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // 💬 Conversation
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: [true, 'La conversation est obligatoire']
  },
  
  // 👤 Expéditeur
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, "L'expéditeur est obligatoire"]
  },
  senderName: {
    type: String,
    required: true
  },
  senderAvatar: {
    type: String,
    default: null
  },
  
  // 📝 Contenu
  content: {
    type: String,
    maxlength: 2000,
    // Content est optionnel pour les messages audio
    required: function() {
      return this.type !== 'audio';
    }
  },
  
  // 📅 Horodatage
  timestamp: {
    type: String,
    default: () => new Date().toISOString()
  },
  
  // ✅ Statut de lecture
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  
  // 🎯 Type de message
  type: {
    type: String,
    enum: ['text', 'image', 'audio', 'offer'],
    default: 'text'
  },
  
  // 📎 Pièces jointes (images)
  attachments: [{
    type: String
  }],
  
  // 💰 Détails de l'offre (si type = 'offer')
  offerDetails: {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    itemTitle: String,
    itemImage: String,
    price: String
  }
}, {
  timestamps: true
});

// 📦 Méthode pour transformer en format Message du frontend
messageSchema.methods.toMessageJSON = function() {
  return {
    id: this._id.toString(),
    conversationId: this.conversationId.toString(),
    senderId: this.senderId.toString(),
    senderName: this.senderName,
    senderAvatar: this.senderAvatar,
    content: this.content,
    timestamp: this.timestamp,
    read: this.read,
    type: this.type,
    attachments: this.attachments,
    offerDetails: this.offerDetails ? {
      itemId: this.offerDetails.itemId?.toString(),
      itemTitle: this.offerDetails.itemTitle,
      itemImage: this.offerDetails.itemImage,
      price: this.offerDetails.price
    } : undefined
  };
};

// ✅ Méthode pour marquer comme lu
messageSchema.methods.markAsRead = async function() {
  if (!this.read) {
    this.read = true;
    this.readAt = new Date();
    await this.save();
    
    // Mettre à jour aussi la conversation
    const Conversation = mongoose.model('Conversation');
    const conversation = await Conversation.findById(this.conversationId);
    if (conversation && conversation.lastMessage.id.toString() === this._id.toString()) {
      conversation.lastMessage.read = true;
      await conversation.save();
    }
  }
};

// 🔍 Index pour performance
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ read: 1 });
messageSchema.index({ type: 1 });

// 📊 Middleware pour mettre à jour la conversation après l'envoi
messageSchema.post('save', async function() {
  if (this.isNew) {
    const Conversation = mongoose.model('Conversation');
    const conversation = await Conversation.findById(this.conversationId);
    if (conversation) {
      await conversation.updateLastMessage(this);
    }
  }
});

// 🎯 Méthode statique pour créer un message avec offre
messageSchema.statics.createOffer = async function(conversationId, sender, item) {
  return await this.create({
    conversationId,
    senderId: sender._id,
    senderName: sender.name,
    senderAvatar: sender.avatar,
    content: `Nouvelle offre pour "${item.title}"`,
    type: 'offer',
    offerDetails: {
      itemId: item._id,
      itemTitle: item.title,
      itemImage: item.mainImage,
      price: item.price
    }
  });
};

// 📸 Méthode statique pour créer un message avec image
messageSchema.statics.createImageMessage = async function(conversationId, sender, imageUrls, caption = '') {
  return await this.create({
    conversationId,
    senderId: sender._id,
    senderName: sender.name,
    senderAvatar: sender.avatar,
    content: caption || 'Image envoyée',
    type: 'image',
    attachments: Array.isArray(imageUrls) ? imageUrls : [imageUrls]
  });
};

module.exports = mongoose.model('Message', messageSchema);
