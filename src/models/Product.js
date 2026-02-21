const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  // 👤 Vendeur
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Le vendeur est obligatoire']
  },
  
  // 📝 Informations de base
  title: {
    type: String,
    required: [true, 'Le titre est obligatoire'],
    trim: true,
    maxlength: [100, 'Le titre ne peut pas dépasser 100 caractères']
  },
  description: {
    type: String,
    required: [true, 'La description est obligatoire'],
    maxlength: 2000
  },
  
  // 🏷️ Catégorisation
  category: {
    type: String,
    required: [true, 'La catégorie est obligatoire'],
    enum: [
      'vehicules',
      'immobilier',
      'electronique',
      'maison',
      'emploi',
      'services',
      'mode',
      'loisirs',
      'materiaux',
      'autres'
    ]
  },
  subcategory: {
    type: String,
    trim: true
  },
  
  // 🎯 Type (produit ou service)
  type: {
    type: String,
    enum: ['product', 'service'],
    required: true,
    default: 'product'
  },
  
  // 💰 Prix (simple string comme frontend)
  price: {
    type: String,
    required: [true, 'Le prix est obligatoire'],
    trim: true
  },
  
  // 📍 Localisation (simple string)
  location: {
    type: String,
    required: [true, 'La localisation est obligatoire'],
    trim: true
  },
  
  // 🖼️ Images (array simple de URLs)
  images: [{
    type: String
  }],
  mainImage: {
    type: String,
    required: true
  },
  
  // 🏷️ Condition (pour produits)
  condition: {
    type: String,
    enum: ['new', 'used', 'refurbished'],
    default: 'used'
  },
  
  // 📦 Quantité (string comme frontend)
  quantity: {
    type: String,
    default: '1'
  },
  
  // 📊 Stats
  views: {
    type: Number,
    default: 0
  },
  favorites: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  
  // ⭐ Mise en avant
  promoted: {
    type: Boolean,
    default: false
  },
  featured: {
    type: Boolean,
    default: false
  },
  
  // 🚚 Livraison (pour produits)
  delivery: {
    available: {
      type: Boolean,
      default: false
    },
    cost: String,
    areas: [String],
    estimatedTime: String
  },
  
  // 📅 Disponibilité (pour services)
  availability: {
    days: [String],
    openingTime: String,
    closingTime: String
  },
  
  // 🌍 Zone de service (pour services)
  serviceArea: [String],
  
  // 📋 Spécifications
  specifications: {
    type: Map,
    of: String,
    default: {}
  },
  
  // 🔄 Statut
  status: {
    type: String,
    enum: ['active', 'pending', 'sold', 'expired'],
    default: 'active'
  }
}, {
  timestamps: true
});

// 📊 Virtual pour "postedTime" (temps relatif)
productSchema.virtual('postedTime').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}j`;
});

// 📅 Virtual pour "postedDate"
productSchema.virtual('postedDate').get(function() {
  return this.createdAt.toISOString().split('T')[0];
});

// 📦 Méthode pour transformer en format Item du frontend
productSchema.methods.toItemJSON = async function() {
  await this.populate('seller');
  
  return {
    id: this._id.toString(),
    title: this.title,
    price: this.price,
    location: this.location,
    images: this.images,
    mainImage: this.mainImage,
    category: this.category,
    subcategory: this.subcategory,
    type: this.type,
    rating: this.rating,
    totalReviews: this.totalReviews,
    seller: this.seller.toSellerJSON ? this.seller.toSellerJSON() : {
      id: this.seller._id.toString(),
      name: this.seller.name,
      avatar: this.seller.avatar
    },
    sellerId: this.seller._id.toString(),
    promoted: this.promoted,
    featured: this.featured,
    postedTime: this.postedTime,
    postedDate: this.postedDate,
    description: this.description,
    condition: this.condition,
    quantity: this.quantity,
    views: this.views,
    favorites: this.favorites,
    delivery: this.delivery,
    availability: this.availability,
    serviceArea: this.serviceArea,
    specifications: Object.fromEntries(this.specifications || new Map()),
    status: this.status
  };
};

// 🔍 Index pour recherche et performance
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ promoted: 1, featured: 1 });
productSchema.index({ title: 'text', description: 'text' });
productSchema.index({ 'location': 1 });

// 📈 Middleware pour incrémenter views
productSchema.methods.incrementViews = async function() {
  this.views += 1;
  await this.save();
};

// ⭐ Middleware pour incrémenter favorites
productSchema.methods.incrementFavorites = async function() {
  this.favorites += 1;
  await this.save();
};

productSchema.methods.decrementFavorites = async function() {
  this.favorites = Math.max(0, this.favorites - 1);
  await this.save();
};

// 📊 Middleware pour mettre à jour rating
productSchema.methods.updateRating = async function(newRating, isNew = true) {
  if (isNew) {
    const total = this.rating * this.totalReviews + newRating;
    this.totalReviews += 1;
    this.rating = total / this.totalReviews;
  } else {
    // Recalculer depuis la base de données
    const Review = mongoose.model('Review');
    const reviews = await Review.find({ 
      item: this._id,
      type: 'product' 
    });
    this.totalReviews = reviews.length;
    this.rating = reviews.length > 0 
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
      : 0;
  }
  await this.save();
};

module.exports = mongoose.model('Product', productSchema);
