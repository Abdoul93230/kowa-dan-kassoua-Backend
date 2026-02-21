const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  // 👤 Utilisateur
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'L\'utilisateur est obligatoire']
  },
  
  // 📦 Produit
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Le produit est obligatoire']
  }
}, {
  timestamps: true
});

// Index composé unique pour éviter les doublons
favoriteSchema.index({ user: 1, product: 1 }, { unique: true });

// Index pour recherche rapide
favoriteSchema.index({ user: 1 });
favoriteSchema.index({ product: 1 });

module.exports = mongoose.model('Favorite', favoriteSchema);
