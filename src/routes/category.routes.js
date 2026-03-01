const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const { protect } = require('../middleware/auth');

// ===============================================
// 📋 ROUTES PUBLIQUES
// ===============================================

// @route   GET /api/categories
// @desc    Liste de toutes les catégories actives
// @access  Public
router.get('/', categoryController.getCategories);

// @route   GET /api/categories/:slug
// @desc    Détails d'une catégorie par slug
// @access  Public
router.get('/:slug', categoryController.getCategoryBySlug);

// ===============================================
// 🔒 ROUTES PROTÉGÉES (Admin uniquement)
// ===============================================

// @route   POST /api/categories
// @desc    Créer une nouvelle catégorie
// @access  Private/Admin
router.post('/', protect, categoryController.createCategory);

// @route   PUT /api/categories/:id
// @desc    Mettre à jour une catégorie
// @access  Private/Admin
router.put('/:id', protect, categoryController.updateCategory);

// @route   DELETE /api/categories/:id
// @desc    Supprimer (désactiver) une catégorie
// @access  Private/Admin
router.delete('/:id', protect, categoryController.deleteCategory);

// @route   POST /api/categories/:id/subcategories
// @desc    Ajouter une sous-catégorie
// @access  Private/Admin
router.post('/:id/subcategories', protect, categoryController.addSubcategory);

// @route   PUT /api/categories/:id/subcategories/:subId
// @desc    Mettre à jour une sous-catégorie
// @access  Private/Admin
router.put('/:id/subcategories/:subId', protect, categoryController.updateSubcategory);

// @route   DELETE /api/categories/:id/subcategories/:subId
// @desc    Supprimer une sous-catégorie
// @access  Private/Admin
router.delete('/:id/subcategories/:subId', protect, categoryController.deleteSubcategory);

// @route   POST /api/categories/:id/update-stats
// @desc    Mettre à jour les statistiques d'une catégorie
// @access  Private/Admin
router.post('/:id/update-stats', protect, categoryController.updateCategoryStats);

// @route   POST /api/categories/update-all-stats
// @desc    Mettre à jour les statistiques de toutes les catégories
// @access  Private/Admin
router.post('/update-all-stats', protect, categoryController.updateAllCategoriesStats);

module.exports = router;
