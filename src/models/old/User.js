const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: [true, 'Le numéro de téléphone est requis'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Le mot de passe est requis'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['buyer', 'seller', 'delivery', 'admin'],
    default: 'buyer'
  },
  profile: {
    firstName: String,
    lastName: String,
    avatar: String,
    bio: String
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    },
    address: {
      country: { type: String, default: 'Niger' },
      city: String,
      quarter: String,
      street: String
    }
  },
  // Pour les vendeurs
  shopInfo: {
    name: String,
    description: String,
    category: String,
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number]
    },
    paymentMethods: [{
      type: String,
      enum: ['cash', 'orange_money', 'mkoudi', 'mynita', 'amanata', 'card']
    }]
  },
  // Pour les livreurs
  deliveryInfo: {
    cniNumber: String,
    cniImage: String,
    vehicle: {
      type: String,
      enum: ['bike', 'motorcycle', 'tricycle', 'car', 'foot']
    },
    isAvailable: { type: Boolean, default: false },
    rating: { type: Number, default: 0 },
    totalDeliveries: { type: Number, default: 0 }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  refreshToken: String
}, {
  timestamps: true
});

// Index géospatial pour recherche par proximité
userSchema.index({ 'location.coordinates': '2dsphere' });
userSchema.index({ 'shopInfo.location.coordinates': '2dsphere' });

// Hash password avant sauvegarde
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Comparer mot de passe
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
