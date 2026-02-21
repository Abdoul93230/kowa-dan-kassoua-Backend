const Favorite = require('../models/Favorite');
const Product = require('../models/Product');

// ===============================================
// ⭐ AJOUTER AUX FAVORIS
// ===============================================
// @desc    Ajouter un produit aux favoris
// @route   POST /api/favorites/:productId
// @access  Private
exports.addFavorite = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    // Vérifier si le produit existe
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // Vérifier si déjà en favoris
    const existingFavorite = await Favorite.findOne({
      user: userId,
      product: productId
    });

    if (existingFavorite) {
      return res.status(400).json({
        success: false,
        message: 'Produit déjà dans vos favoris'
      });
    }

    // Créer le favori
    const favorite = await Favorite.create({
      user: userId,
      product: productId
    });

    // Incrémenter le compteur de favoris du produit
    await product.incrementFavorites();

    res.status(201).json({
      success: true,
      message: 'Produit ajouté aux favoris',
      data: favorite
    });

  } catch (error) {
    console.error('❌ Erreur ajout favori:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'ajout aux favoris',
      error: error.message
    });
  }
};

// ===============================================
// ❌ RETIRER DES FAVORIS
// ===============================================
// @desc    Retirer un produit des favoris
// @route   DELETE /api/favorites/:productId
// @access  Private
exports.removeFavorite = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    // Chercher le favori
    const favorite = await Favorite.findOne({
      user: userId,
      product: productId
    });

    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé dans vos favoris'
      });
    }

    // Supprimer le favori
    await Favorite.deleteOne({ _id: favorite._id });

    // Décrémenter le compteur de favoris du produit
    const product = await Product.findById(productId);
    if (product) {
      await product.decrementFavorites();
    }

    res.status(200).json({
      success: true,
      message: 'Produit retiré des favoris'
    });

  } catch (error) {
    console.error('❌ Erreur suppression favori:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du favori',
      error: error.message
    });
  }
};

// ===============================================
// 📋 OBTENIR MES FAVORIS
// ===============================================
// @desc    Obtenir la liste de mes favoris
// @route   GET /api/favorites
// @access  Private
exports.getMyFavorites = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Récupérer tous les favoris pour compter les actifs
    const allFavorites = await Favorite.find({ user: userId })
      .populate({
        path: 'product',
        populate: {
          path: 'seller'
        }
      })
      .sort('-createdAt');

    // Filtrer les produits supprimés ET les produits non actifs
    const activeFavorites = allFavorites.filter(f => f.product && f.product.status === 'active');
    
    // Compter uniquement les favoris actifs
    const total = activeFavorites.length;
    
    // Paginer les favoris actifs
    const paginatedFavorites = activeFavorites.slice(skip, skip + parseInt(limit));

    // Transformer en format Item
    const items = await Promise.all(
      paginatedFavorites.map(async (f) => {
        return f.product.toItemJSON();
      })
    );

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération favoris:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des favoris',
      error: error.message
    });
  }
};

// ===============================================
// ✅ VÉRIFIER SI EN FAVORIS
// ===============================================
// @desc    Vérifier si un produit est dans mes favoris
// @route   GET /api/favorites/check/:productId
// @access  Private
exports.checkFavorite = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    const favorite = await Favorite.findOne({
      user: userId,
      product: productId
    });

    res.status(200).json({
      success: true,
      data: {
        isFavorite: !!favorite
      }
    });

  } catch (error) {
    console.error('❌ Erreur vérification favori:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification',
      error: error.message
    });
  }
};

// ===============================================
// 📊 OBTENIR IDS DES FAVORIS
// ===============================================
// @desc    Obtenir uniquement les IDs des produits actifs en favoris (pour l'UI)
// @route   GET /api/favorites/ids
// @access  Private
exports.getFavoriteIds = async (req, res) => {
  try {
    const userId = req.user._id;

    const favorites = await Favorite.find({ user: userId })
      .populate('product', 'status')
      .select('product');
    
    // Ne retourner que les IDs des produits actifs
    const productIds = favorites
      .filter(f => f.product && f.product.status === 'active')
      .map(f => f.product._id.toString());

    res.status(200).json({
      success: true,
      data: productIds
    });

  } catch (error) {
    console.error('❌ Erreur récupération IDs favoris:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des IDs',
      error: error.message
    });
  }
};
