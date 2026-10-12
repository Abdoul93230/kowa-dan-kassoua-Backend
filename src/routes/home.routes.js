const express = require('express');
const router = express.Router();
const homeController = require('../controllers/home.controller');

// @route   GET /api/home
// @desc    Données complètes de l'écran d'accueil (une seule requête, en cache)
// @access  Public
router.get('/', homeController.getHome);

module.exports = router;
