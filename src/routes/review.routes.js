const express = require('express');
const router = express.Router();
const {
  createReview,
  getProductReviews,
  deleteReview,
  markHelpful,
  getReviewStats
} = require('../controllers/review.controller');
const { protect } = require('../middleware/auth');

// ✍️ Créer un avis (authentification requise)
router.post('/', protect, createReview);

// 📋 Récupérer les avis d'un produit (public)
router.get('/product/:productId', getProductReviews);

// 📊 Récupérer les stats d'avis d'un produit (public)
router.get('/product/:productId/stats', getReviewStats);

// 👍 Marquer un avis comme utile (public)
router.post('/:id/helpful', markHelpful);

// 🗑️ Supprimer un avis (authentification requise)
router.delete('/:id', protect, deleteReview);

module.exports = router;
