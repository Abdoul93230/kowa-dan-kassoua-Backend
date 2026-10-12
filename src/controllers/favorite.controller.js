const Favorite = require('../models/Favorite');
const Product = require('../models/Product');
const { findProducts } = require('../utils/productSerializer');

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

    if (!(await Product.exists({ _id: productId }))) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // L'index unique (user, product) garantit l'absence de doublon, même en cas de double tap
    let favorite;
    try {
      favorite = await Favorite.create({ user: userId, product: productId });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Produit déjà dans vos favoris'
        });
      }
      throw error;
    }

    // Compteur du produit : incrément atomique (sans relire ni réécrire tout le document)
    await Product.updateOne({ _id: productId }, { $inc: { favorites: 1 } }, { timestamps: false });

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

    const favorite = await Favorite.findOneAndDelete({ user: userId, product: productId });

    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé dans vos favoris'
      });
    }

    // Décrément atomique, sans descendre sous zéro
    await Product.updateOne(
      { _id: productId, favorites: { $gt: 0 } },
      { $inc: { favorites: -1 } },
      { timestamps: false }
    );

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
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const view = req.query.view === 'card' ? 'card' : 'full';

    // 1) Identifiants seulement (avant : tous les favoris avec produit ET vendeur complets,
    //    puis 3 requêtes par annonce — le coût grandissait avec chaque favori ajouté)
    const favorites = await Favorite.find({ user: userId }).sort('-createdAt').select('product').lean();
    const orderedIds = favorites.map((f) => f.product).filter(Boolean);

    // 2) Ne garder que les annonces encore en ligne, dans l'ordre des favoris
    const activeIds = new Set(
      (await Product.find({ _id: { $in: orderedIds }, status: 'active' }).select('_id').lean())
        .map((p) => String(p._id))
    );
    const activeOrdered = orderedIds.filter((id) => activeIds.has(String(id)));
    const total = activeOrdered.length;

    // 3) Charger uniquement la page demandée, en lot
    const pageIds = activeOrdered.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    const items = await findProducts({ _id: { $in: pageIds } }, { limit: limitNum, view });
    const position = new Map(pageIds.map((id, i) => [String(id), i]));
    items.sort((a, b) => position.get(a.id) - position.get(b.id));

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
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

    const favorites = await Favorite.find({ user: userId }).select('product').lean();
    const active = await Product.find({
      _id: { $in: favorites.map((f) => f.product).filter(Boolean) },
      status: 'active'
    }).select('_id').lean();

    // Ne retourner que les IDs des produits actifs
    const productIds = active.map((p) => p._id.toString());

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
