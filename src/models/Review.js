const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // 👤 Utilisateur qui laisse l'avis
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, "L'utilisateur est obligatoire"]
  },
  userName: {
    type: String,
    required: true
  },
  userAvatar: {
    type: String,
    default: null
  },
  
  // 🎯 Type et cible (produit ou vendeur)
  type: {
    type: String,
    enum: ['product', 'seller'],
    required: true
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'itemModel',
    required: true
  },
  itemModel: {
    type: String,
    enum: ['Product', 'User'],
    required: true
  },
  
  // ⭐ Note et commentaire
  rating: {
    type: Number,
    required: [true, 'La note est obligatoire'],
    min: [1, 'La note minimale est 1'],
    max: [5, 'La note maximale est 5']
  },
  comment: {
    type: String,
    required: [true, 'Le commentaire est obligatoire'],
    maxlength: [1000, 'Le commentaire ne peut pas dépasser 1000 caractères']
  },
  
  // 👍 Compteur "utile"
  helpful: {
    type: Number,
    default: 0
  },
  
  // 📅 Date (utilise timestamps.createdAt)
}, {
  timestamps: true
});

// 📅 Virtual pour "date" (format frontend)
reviewSchema.virtual('date').get(function() {
  return this.createdAt.toISOString();
});

// 📦 Méthode pour transformer en format Review du frontend
reviewSchema.methods.toReviewJSON = function() {
  return {
    id: this._id.toString(),
    userId: this.user.toString(),
    userName: this.userName,
    userAvatar: this.userAvatar,
    rating: this.rating,
    comment: this.comment,
    date: this.date,
    helpful: this.helpful
  };
};

// 🔍 Index pour performance
reviewSchema.index({ item: 1, type: 1 });
reviewSchema.index({ user: 1 });
reviewSchema.index({ createdAt: -1 });

// 📊 Middleware pour mettre à jour les stats du produit/vendeur
reviewSchema.post('save', async function() {
  if (this.type === 'product') {
    const Product = mongoose.model('Product');
    const product = await Product.findById(this.item);
    if (product) {
      await product.updateRating(this.rating, true);
    }
  } else if (this.type === 'seller') {
    const User = mongoose.model('User');
    const seller = await User.findById(this.item);
    if (seller) {
      // Recalculer le rating du vendeur
      const reviews = await this.constructor.find({ 
        item: this.item,
        type: 'seller' 
      });
      seller.sellerStats.totalReviews = reviews.length;
      seller.sellerStats.rating = reviews.length > 0 
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
        : 0;
      await seller.save();
    }
  }
});

// 📊 Middleware pour mettre à jour les stats lors de la suppression
reviewSchema.post('findOneAndDelete', async function(doc) {
  if (!doc) return;
  
  if (doc.type === 'product') {
    const Product = mongoose.model('Product');
    const product = await Product.findById(doc.item);
    if (product) {
      await product.updateRating(0, false); // Recalculer
    }
  } else if (doc.type === 'seller') {
    const User = mongoose.model('User');
    const seller = await User.findById(doc.item);
    if (seller) {
      const Review = mongoose.model('Review');
      const reviews = await Review.find({ 
        item: doc.item,
        type: 'seller' 
      });
      seller.sellerStats.totalReviews = reviews.length;
      seller.sellerStats.rating = reviews.length > 0 
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
        : 0;
      await seller.save();
    }
  }
});

// 👍 Méthode pour incrémenter helpful
reviewSchema.methods.incrementHelpful = async function() {
  this.helpful += 1;
  await this.save();
};

module.exports = mongoose.model('Review', reviewSchema);
