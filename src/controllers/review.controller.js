const Review = require('../models/Review');
const Product = require('../models/Product');
const User = require('../models/User');

// ===============================================
// ✍️ CRÉER UN AVIS
// ===============================================
// @desc    Créer un avis pour un produit
// @route   POST /api/reviews
// @access  Private (authentifié)
exports.createReview = async (req, res) => {
  try {
    const { productId, rating, comment } = req.body;

    // Validation
    if (!productId || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Produit, note et commentaire sont obligatoires'
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'La note doit être entre 1 et 5'
      });
    }

    // Vérifier que le produit existe
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // Vérifier si l'utilisateur n'a pas déjà laissé un avis pour ce produit
    const existingReview = await Review.findOne({
      user: req.user.id,
      item: productId,
      type: 'product'
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Vous avez déjà laissé un avis pour ce produit'
      });
    }

    // Récupérer l'utilisateur pour avoir son nom et avatar
    const user = await User.findById(req.user.id);

    // Créer l'avis
    const review = await Review.create({
      user: req.user.id,
      userName: user.name,
      userAvatar: user.avatar,
      type: 'product',
      item: productId,
      itemModel: 'Product',
      rating,
      comment: comment.trim()
    });

    // Le middleware du modèle Review va automatiquement mettre à jour les stats du produit

    res.status(201).json({
      success: true,
      message: 'Avis créé avec succès',
      data: review.toReviewJSON()
    });

  } catch (error) {
    console.error('❌ Erreur création avis:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'avis',
      error: error.message
    });
  }
};

// ===============================================
// 📋 OBTENIR LES AVIS D'UN PRODUIT
// ===============================================
// @desc    Récupérer tous les avis d'un produit
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10, sort = '-createdAt' } = req.query;

    // Vérifier que le produit existe
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reviews, total] = await Promise.all([
      Review.find({ item: productId, type: 'product' })
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Review.countDocuments({ item: productId, type: 'product' })
    ]);

    // Transformer en format JSON
    const reviewsJSON = reviews.map(review => review.toReviewJSON());

    res.status(200).json({
      success: true,
      data: reviewsJSON,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: {
        averageRating: product.rating,
        totalReviews: product.totalReviews
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération avis:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des avis',
      error: error.message
    });
  }
};

// ===============================================
// 🗑️ SUPPRIMER UN AVIS
// ===============================================
// @desc    Supprimer son propre avis
// @route   DELETE /api/reviews/:id
// @access  Private (authentifié)
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Avis introuvable'
      });
    }

    // Vérifier que l'utilisateur est bien l'auteur de l'avis
    if (review.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Vous ne pouvez supprimer que vos propres avis'
      });
    }

    await review.deleteOne();
    // Le middleware post('findOneAndDelete') va automatiquement mettre à jour les stats

    res.status(200).json({
      success: true,
      message: 'Avis supprimé avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur suppression avis:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'avis',
      error: error.message
    });
  }
};

// ===============================================
// 👍 MARQUER UN AVIS COMME UTILE
// ===============================================
// @desc    Incrémenter le compteur "helpful" d'un avis
// @route   POST /api/reviews/:id/helpful
// @access  Public
exports.markHelpful = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Avis introuvable'
      });
    }

    await review.incrementHelpful();

    res.status(200).json({
      success: true,
      message: 'Avis marqué comme utile',
      data: {
        helpful: review.helpful
      }
    });

  } catch (error) {
    console.error('❌ Erreur marquage avis utile:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage de l\'avis',
      error: error.message
    });
  }
};

// ===============================================
// 📊 OBTENIR LES STATISTIQUES D'AVIS
// ===============================================
// @desc    Obtenir les statistiques détaillées des avis d'un produit
// @route   GET /api/reviews/product/:productId/stats
// @access  Public
exports.getReviewStats = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // Récupérer tous les avis du produit
    const reviews = await Review.find({ item: productId, type: 'product' });

    // Calculer la distribution des notes
    const ratingDistribution = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0
    };

    reviews.forEach(review => {
      ratingDistribution[review.rating]++;
    });

    res.status(200).json({
      success: true,
      data: {
        averageRating: product.rating,
        totalReviews: product.totalReviews,
        ratingDistribution
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération stats avis:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques',
      error: error.message
    });
  }
};
