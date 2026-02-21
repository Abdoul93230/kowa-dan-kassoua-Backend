const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Le titre est requis'],
    trim: true,
    maxlength: 200
  },
  description: {
    text: String,
    audio: String // URL audio Cloudinary
  },
  category: {
    type: String,
    required: true,
    enum: [
      'food', 'clothing', 'electronics', 'furniture', 
      'beauty', 'services', 'agriculture', 'crafts', 'other'
    ]
  },
  subcategory: String,
  images: [{
    url: String,
    publicId: String
  }],
  price: {
    amount: {
      type: Number,
      required: true
    },
    unit: {
      type: String,
      enum: ['unit', 'kg', 'liter', 'meter', 'hour', 'day'],
      default: 'unit'
    },
    currency: {
      type: String,
      default: 'XOF'
    }
  },
  stock: {
    quantity: {
      type: Number,
      default: 0
    },
    isAvailable: {
      type: Boolean,
      default: true
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      index: '2dsphere'
    }
  },
  paymentMethods: [{
    type: String,
    enum: ['cash', 'orange_money', 'mkoudi', 'mynita', 'amanata', 'card', 'on_delivery']
  }],
  // Métadonnées IA
  aiMetadata: {
    detectedObjects: [String],
    extractedText: String,
    tags: [String]
  },
  rating: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  views: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index pour recherche
productSchema.index({ title: 'text', 'description.text': 'text' });
productSchema.index({ category: 1, price: 1 });
productSchema.index({ 'location.coordinates': '2dsphere' });

module.exports = mongoose.model('Product', productSchema);
