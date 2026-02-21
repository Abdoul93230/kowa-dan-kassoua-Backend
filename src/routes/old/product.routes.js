const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const { protect, authorize } = require('../middleware/auth');

// @route   GET /api/products
// @desc    Obtenir tous les produits (avec filtres)
// @access  Public
router.get('/', productController.getProducts);

// @route   GET /api/products/nearby
// @desc    Obtenir produits à proximité
// @access  Public
router.get('/nearby', productController.getNearbyProducts);

// @route   GET /api/products/:id
// @desc    Obtenir un produit par ID
// @access  Public
router.get('/:id', productController.getProduct);

// @route   POST /api/products
// @desc    Créer un produit
// @access  Private (Seller only)
router.post('/', protect, authorize('seller', 'admin'), productController.createProduct);

// @route   PUT /api/products/:id
// @desc    Modifier un produit
// @access  Private (Seller owner)
router.put('/:id', protect, productController.updateProduct);

// @route   DELETE /api/products/:id
// @desc    Supprimer un produit
// @access  Private (Seller owner)
router.delete('/:id', protect, productController.deleteProduct);

module.exports = router;
