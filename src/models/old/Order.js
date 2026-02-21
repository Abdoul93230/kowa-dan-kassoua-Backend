const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true
    }
  }],
  delivery: {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number]
    },
    address: {
      city: String,
      quarter: String,
      street: String,
      details: String
    },
    price: {
      proposed: Number, // Prix proposé par acheteur
      final: Number     // Prix final négocié
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled'],
      default: 'pending'
    },
    tracking: [{
      status: String,
      location: {
        type: { type: String, enum: ['Point'] },
        coordinates: [Number]
      },
      timestamp: { type: Date, default: Date.now }
    }]
  },
  payment: {
    method: {
      type: String,
      enum: ['cash', 'orange_money', 'mkoudi', 'mynita', 'amanata', 'card', 'on_delivery'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },
    amount: {
      subtotal: Number,
      delivery: Number,
      total: Number
    },
    transactionId: String
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  notes: String
}, {
  timestamps: true
});

// Index
orderSchema.index({ buyer: 1, status: 1 });
orderSchema.index({ 'items.seller': 1 });
orderSchema.index({ 'delivery.driver': 1 });

module.exports = mongoose.model('Order', orderSchema);
