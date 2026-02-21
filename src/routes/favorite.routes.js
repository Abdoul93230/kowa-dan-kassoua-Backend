const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favorite.controller');
const { protect } = require('../middleware/auth');

// ===============================================
// 🔒 ROUTES PROTÉGÉES (authentification requise)
// ===============================================

// @route   GET /api/favorites
// @desc    Obtenir mes favoris
// @access  Private
router.get('/', protect, favoriteController.getMyFavorites);

// @route   GET /api/favorites/ids
// @desc    Obtenir les IDs de mes favoris
// @access  Private
router.get('/ids', protect, favoriteController.getFavoriteIds);

// @route   GET /api/favorites/check/:productId
// @desc    Vérifier si un produit est en favoris
// @access  Private
router.get('/check/:productId', protect, favoriteController.checkFavorite);

// @route   POST /api/favorites/:productId
// @desc    Ajouter un produit aux favoris
// @access  Private
router.post('/:productId', protect, favoriteController.addFavorite);

// @route   DELETE /api/favorites/:productId
// @desc    Retirer un produit des favoris
// @access  Private
router.delete('/:productId', protect, favoriteController.removeFavorite);

module.exports = router;
