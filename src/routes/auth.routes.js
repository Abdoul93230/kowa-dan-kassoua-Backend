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

// @route   POST /api/auth/check-phone
// @desc    Vérifier si un numéro de téléphone existe (Mode 1)
// @access  Public
router.post('/check-phone', authController.checkPhone);

// @route   POST /api/auth/quick-register
// @desc    Inscription rapide contextuelle (Mode 1)
// @access  Public
router.post('/quick-register', authController.quickRegister);

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

// @route   PUT /api/auth/profile
// @desc    Mettre à jour profil utilisateur
// @access  Private
router.put('/profile', protect, authController.updateProfile);

// @route   POST /api/auth/push-token
// @desc    Enregistrer le token Expo pour notifications push
// @access  Private
router.post('/push-token', protect, authController.registerPushToken);

// @route   POST /api/auth/push-token-public
// @desc    Enregistrer le token Expo pour notifications push sans Bearer
// @access  Public
router.post('/push-token-public', authController.registerPushTokenPublic);

// @route   PUT /api/auth/change-password
// @desc    Changer le mot de passe
// @access  Private
router.put('/change-password', protect, authController.changePassword);

module.exports = router;
