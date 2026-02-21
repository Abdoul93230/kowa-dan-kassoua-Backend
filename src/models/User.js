const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // 📱 Authentification (phone ou email selon formulaire login)
  phone: {
    type: String,
    required: [true, 'Le numéro de téléphone est obligatoire'],
    unique: true,
    trim: true,
    // Format: "+227 12345678" (avec indicatif pays)
  },
  email: {
    type: String,
    unique: true,
    sparse: true,  // Permet null/undefined tout en gardant l'unicité
    trim: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Format email invalide']
  },
  password: {
    type: String,
    required: [true, 'Le mot de passe est obligatoire'],
    minlength: [6, 'Le mot de passe doit contenir au moins 6 caractères'],
    select: false
  },
  
  // 👤 Profil utilisateur (selon formulaire inscription étape 1)
  name: {
    type: String,
    required: [true, 'Le nom est obligatoire'],
    trim: true,
    minlength: [2, 'Le nom doit contenir au moins 2 caractères']
  },
  avatar: {
    type: String,
    default: null
  },
  
  // 🏪 Informations business (selon formulaire inscription étape 2)
  businessType: {
    type: String,
    enum: ['individual', 'professional'],
    default: 'individual'
  },
  businessName: {
    type: String,
    trim: true,
    default: ''
  },
  description: {
    type: String,
    maxlength: 1000,
    default: ''
  },
  
  // 📍 Localisation (obligatoire à l'inscription)
  location: {
    type: String,
    required: [true, 'La localisation est obligatoire'],
    trim: true
  },
  
  // 📞 Contact Info (selon formulaire inscription)
  contactInfo: {
    whatsapp: String,     // Numéro WhatsApp (avec indicatif)
    website: String,
    facebook: String,
    instagram: String
  },
  
  // 🔐 Rôle
  role: {
    type: String,
    enum: ['buyer', 'seller', 'admin'],
    default: 'seller'  // Par défaut seller (inscription = vente)
  },
  
  // 🏪 Stats vendeur (pour Seller interface frontend)
  sellerStats: {
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
    responseTime: {
      type: String,
      default: '> 24h'  // "< 1h", "1-6h", "6-24h", "> 24h"
    },
    responseRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    totalListings: {
      type: Number,
      default: 0
    },
    categories: [{
      type: String
    }]
  },
  
  // ✅ Vérification
  verified: {
    type: Boolean,
    default: false
  },
  
  // 📱 OTP (One-Time Password) pour vérification
  otp: {
    code: {
      type: String
    },
    expiresAt: {
      type: Date
    },
    verified: {
      type: Boolean,
      default: false
    },
    attempts: {
      type: Number,
      default: 0
    },
    lastAttempt: {
      type: Date
    }
  },
  
  // �🔑 Refresh Token
  refreshToken: {
    type: String,
    select: false
  },
  
  // 🚫 Compte actif
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true  // createdAt, updatedAt
});

// 🔐 Hash password avant sauvegarde
userSchema.pre('save', async function(next) {
  // Validation conditionnelle : businessName requis pour les professionnels
  if (this.businessType === 'professional' && !this.businessName) {
    const error = new Error('Le nom de l\'activité est obligatoire pour un compte professionnel');
    return next(error);
  }
  
  // Hash password si modifié
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ✅ Méthode pour comparer password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 📅 Virtual pour "memberSince" (format lisible)
userSchema.virtual('memberSince').get(function() {
  return this.createdAt.toLocaleDateString('fr-FR', { 
    month: 'long', 
    year: 'numeric' 
  });
});

// 📦 Transformer pour retourner format Seller du frontend
userSchema.methods.toSellerJSON = async function() {
  // Compter dynamiquement les annonces actives du vendeur
  const Product = require('./Product');
  const totalListings = await Product.countDocuments({ 
    seller: this._id, 
    status: 'active' 
  });

  return {
    id: this._id.toString(),
    name: this.name,
    avatar: this.avatar,
    rating: this.sellerStats.rating,
    totalReviews: this.sellerStats.totalReviews,
    verified: this.verified,
    memberSince: this.memberSince,
    responseTime: this.sellerStats.responseTime,
    responseRate: this.sellerStats.responseRate,
    location: this.location,
    bio: this.description,
    contactInfo: {
      phone: this.phone,
      whatsapp: this.contactInfo.whatsapp,
      email: this.email,
      website: this.contactInfo.website,
      facebook: this.contactInfo.facebook,
      instagram: this.contactInfo.instagram
    },
    totalListings: totalListings,
    categories: this.sellerStats.categories
  };
};

// 📦 Transformer pour retourner les infos publiques
userSchema.methods.toPublicJSON = function() {
  return {
    id: this._id.toString(),
    name: this.name,
    avatar: this.avatar,
    businessName: this.businessName,
    businessType: this.businessType,
    location: this.location,
    verified: this.verified,
    memberSince: this.memberSince
  };
};

// 🔍 Index pour recherche et performance
userSchema.index({ name: 'text', businessName: 'text', description: 'text' });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ location: 1 });

module.exports = mongoose.model('User', userSchema);
