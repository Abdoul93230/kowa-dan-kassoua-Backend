const mongoose = require('mongoose');

const subcategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  icon: {
    type: String,
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  }
}, { _id: true });

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Le nom de la catégorie est obligatoire'],
    trim: true,
    unique: true
  },
  slug: {
    type: String,
    required: [true, 'Le slug est obligatoire'],
    trim: true,
    lowercase: true,
    unique: true,
    index: true
  },
  description: {
    type: String,
    trim: true
  },
  icon: {
    type: String,
    trim: true,
    default: 'Package'
  },
  image: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    default: 'bg-gray-100 text-gray-600'
  },
  subcategories: [subcategorySchema],
  active: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  // Métadonnées SEO
  metaTitle: {
    type: String,
    trim: true
  },
  metaDescription: {
    type: String,
    trim: true
  },
  // Stats (mis à jour automatiquement)
  productsCount: {
    type: Number,
    default: 0
  },
  servicesCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index pour la recherche
categorySchema.index({ name: 'text', description: 'text' });

// Méthode pour obtenir le nombre total d'annonces (produits + services)
categorySchema.virtual('totalCount').get(function() {
  return this.productsCount + this.servicesCount;
});

// S'assurer que les virtuals sont inclus dans JSON
categorySchema.set('toJSON', { virtuals: true });
categorySchema.set('toObject', { virtuals: true });

// Méthode pour mettre à jour les statistiques
categorySchema.methods.updateStats = async function() {
  const Product = mongoose.model('Product');
  
  const stats = await Product.aggregate([
    { $match: { category: this._id, status: 'active' } },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 }
      }
    }
  ]);
  
  this.productsCount = stats.find(s => s._id === 'product')?.count || 0;
  this.servicesCount = stats.find(s => s._id === 'service')?.count || 0;
  
  await this.save();
};

// Méthode statique pour mettre à jour toutes les stats
categorySchema.statics.updateAllStats = async function() {
  const categories = await this.find();
  
  for (const category of categories) {
    await category.updateStats();
  }
};

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
