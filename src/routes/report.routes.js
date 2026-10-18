const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const reportController = require('../controllers/report.controller');

// @route   POST /api/reports
// @desc    Signaler une annonce
// @access  Private (connecté)
router.post('/', protect, reportController.createReport);

// @route   GET /api/reports?status=open|resolved|dismissed
// @desc    Signalements regroupés par annonce
// @access  Admin
router.get('/', protect, authorize('admin'), reportController.listReports);

// @route   PATCH /api/reports/product/:productId
// @desc    Retirer l'annonce ou rejeter ses signalements
// @access  Admin
router.patch('/product/:productId', protect, authorize('admin'), reportController.handleProductReports);

module.exports = router;
