const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  // 👥 Participants
  participants: {
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  
  // 📦 Article concerné (optionnel)
  item: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    title: String,
    image: String,
    price: String
  },
  
  // 💬 Dernier message
  lastMessage: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    content: String,
    senderId: String,
    senderName: String,
    timestamp: String,
    read: Boolean,
    type: {
      type: String,
      enum: ['text', 'image', 'offer'],
      default: 'text'
    }
  },
  
  // 📊 Messages non lus
  unreadCount: {
    buyer: {
      type: Number,
      default: 0
    },
    seller: {
      type: Number,
      default: 0
    }
  },
  
  // 🔄 Statut
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true
});

// 📦 Méthode pour transformer en format Conversation du frontend
conversationSchema.methods.toConversationJSON = async function(userId) {
  // Populate les participants si nécessaire
  if (!this.populated('participants.buyer')) {
    await this.populate('participants.buyer participants.seller');
  }
  
  // Déterminer qui est l'acheteur et le vendeur
  const isBuyer = this.participants.buyer._id.toString() === userId.toString();
  const otherUser = isBuyer ? this.participants.seller : this.participants.buyer;
  const unread = isBuyer ? this.unreadCount.buyer : this.unreadCount.seller;
  
  return {
    id: this._id.toString(),
    participants: {
      buyer: {
        id: this.participants.buyer._id.toString(),
        name: this.participants.buyer.name,
        avatar: this.participants.buyer.avatar
      },
      seller: this.participants.seller.toSellerJSON 
        ? this.participants.seller.toSellerJSON() 
        : {
            id: this.participants.seller._id.toString(),
            name: this.participants.seller.name,
            avatar: this.participants.seller.avatar
          }
    },
    item: this.item.id ? {
      id: this.item.id.toString(),
      title: this.item.title,
      image: this.item.image,
      price: this.item.price
    } : null,
    lastMessage: this.lastMessage,
    unreadCount: unread,
    createdAt: this.createdAt.toISOString(),
    updatedAt: this.updatedAt.toISOString(),
    status: this.status
  };
};

// 💬 Méthode pour mettre à jour le dernier message
conversationSchema.methods.updateLastMessage = async function(message) {
  this.lastMessage = {
    id: message._id,
    content: message.content,
    senderId: message.senderId.toString(),
    senderName: message.senderName,
    timestamp: message.timestamp,
    read: message.read,
    type: message.type
  };
  this.updatedAt = new Date();
  
  // Incrémenter unread pour le destinataire
  const isSenderBuyer = message.senderId.toString() === this.participants.buyer.toString();
  if (isSenderBuyer) {
    this.unreadCount.seller += 1;
  } else {
    this.unreadCount.buyer += 1;
  }
  
  await this.save();
};

// ✅ Méthode pour marquer comme lu
conversationSchema.methods.markAsRead = async function(userId) {
  const isBuyer = this.participants.buyer.toString() === userId.toString();
  
  if (isBuyer) {
    this.unreadCount.buyer = 0;
  } else {
    this.unreadCount.seller = 0;
  }
  
  await this.save();
};

// 📁 Méthode pour archiver
conversationSchema.methods.archive = async function() {
  this.status = 'archived';
  await this.save();
};

conversationSchema.methods.unarchive = async function() {
  this.status = 'active';
  await this.save();
};

// 🔍 Index pour recherche et performance
conversationSchema.index({ 'participants.buyer': 1, status: 1 });
conversationSchema.index({ 'participants.seller': 1, status: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ 'item.id': 1 });

// 🔍 Méthode statique pour trouver ou créer une conversation
conversationSchema.statics.findOrCreate = async function(buyerId, sellerId, item = null) {
  let conversation = await this.findOne({
    'participants.buyer': buyerId,
    'participants.seller': sellerId,
    'item.id': item?.id || null
  });
  
  if (!conversation) {
    conversation = await this.create({
      participants: {
        buyer: buyerId,
        seller: sellerId
      },
      item: item ? {
        id: item.id,
        title: item.title,
        image: item.image,
        price: item.price
      } : null
    });
  }
  
  return conversation;
};

module.exports = mongoose.model('Conversation', conversationSchema);
