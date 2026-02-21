const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');

// ===============================================
// 📝 ROUTES PUBLIQUES
// ===============================================

// @route   POST /api/auth/register
// @desc    Inscription utilisateur (2 étapes frontend)
// @access  Public
router.post('/register', authController.register);

// @route   POST /api/auth/login
// @desc    Connexion utilisateur (phone OU email)
// @access  Public
router.post('/login', authController.login);

// @route   POST /api/auth/refresh
// @desc    Rafraîchir access token
// @access  Public
router.post('/refresh', authController.refreshToken);

// @route   POST /api/auth/forgot-password
// @desc    Demander code de réinitialisation
// @access  Public
router.post('/forgot-password', authController.forgotPassword);

// @route   POST /api/auth/verify-reset-code
// @desc    Vérifier le code de réinitialisation (sans changer le mot de passe)
// @access  Public
router.post('/verify-reset-code', authController.verifyResetCode);

// @route   POST /api/auth/reset-password
// @desc    Réinitialiser le mot de passe
// @access  Public
router.post('/reset-password', authController.resetPassword);

// @route   POST /api/auth/send-otp
// @desc    Envoyer code OTP pour vérification
// @access  Public
router.post('/send-otp', authController.sendOTP);

// @route   POST /api/auth/verify-otp
// @desc    Vérifier le code OTP
// @access  Public
router.post('/verify-otp', authController.verifyOTP);

// @route   GET /api/auth/seller/:id
// @desc    Obtenir le profil public d'un vendeur
// @access  Public
router.get('/seller/:id', authController.getSellerProfile);

// ===============================================
// 🔐 ROUTES PROTÉGÉES
// ===============================================

// @route   POST /api/auth/logout
// @desc    Déconnexion utilisateur
// @access  Private
router.post('/logout', protect, authController.logout);

// @route   GET /api/auth/me
// @desc    Obtenir profil utilisateur connecté
// @access  Private
router.get('/me', protect, authController.getMe);

module.exports = router;
