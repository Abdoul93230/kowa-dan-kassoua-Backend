const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const { protect } = require('../middleware/auth');

// ===============================================
// 📋 ROUTES PUBLIQUES
// ===============================================

// @route   GET /api/products
// @desc    Liste des produits (avec filtres et pagination)
// @access  Public
router.get('/', productController.getProducts);

// ===============================================
// 🔒 ROUTES PROTÉGÉES (authentification requise)
// ===============================================
// ⚠️ IMPORTANT : Routes spécifiques AVANT les routes génériques avec :id

// @route   GET /api/products/my/listings
// @desc    Mes annonces
// @access  Private
router.get('/my/listings', protect, productController.getMyProducts);

// @route   GET /api/products/my/stats
// @desc    Statistiques de mes annonces
// @access  Private
router.get('/my/stats', protect, productController.getMyStats);

// @route   GET /api/products/locations
// @desc    Liste des localisations uniques des produits actifs
// @access  Public
router.get('/locations', productController.getLocations);

// @route   POST /api/products
// @desc    Créer une nouvelle annonce
// @access  Private
router.post('/', protect, productController.createProduct);

// @route   GET /api/products/:id
// @desc    Détails d'un produit
// @access  Public
router.get('/:id', productController.getProductById);

// @route   PUT /api/products/:id
// @desc    Modifier une annonce
// @access  Private (propriétaire uniquement)
router.put('/:id', protect, productController.updateProduct);

// @route   DELETE /api/products/:id
// @desc    Supprimer une annonce
// @access  Private (propriétaire uniquement)
router.delete('/:id', protect, productController.deleteProduct);

// @route   PATCH /api/products/:id/promote
// @desc    Promouvoir une annonce
// @access  Private (propriétaire uniquement)
router.patch('/:id/promote', protect, productController.promoteProduct);

// @route   PATCH /api/products/:id/toggle-status
// @desc    Activer/désactiver une annonce
// @access  Private (propriétaire uniquement)
router.patch('/:id/toggle-status', protect, productController.toggleStatus);

module.exports = router;
