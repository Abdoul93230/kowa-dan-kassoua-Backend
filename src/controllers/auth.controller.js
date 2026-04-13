const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Product = require('../models/Product');
const { uploadImage } = require('../utils/uploadImage');

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();
const normalizePhone = (value = '') => String(value || '').trim().replace(/\s+/g, ' ');
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 🔐 Générer Access Token (JWT)
const generateAccessToken = (userId) => {
  return jwt.sign(
    { id: userId }, 
    process.env.JWT_SECRET || 'dev_secret_key_2026', 
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// 🔄 Générer Refresh Token
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { id: userId }, 
    process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_key_2026', 
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
  );
};

// ===============================================
// 📝 INSCRIPTION (Register)
// ===============================================
// @desc    Inscription utilisateur (2 étapes frontend)
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const {
      // Étape 1
      name,
      phone,           // Format: "+227 12345678"
      whatsapp,        // Format: "+227 98765432"
      email,           // Optionnel
      password,
      // Étape 2
      businessType,    // 'individual' | 'professional'
      businessName,
      description,
      location,
      avatar
    } = req.body;

    // ✅ Validation des champs obligatoires
    if (!name || !phone || !password || !location) {
      return res.status(400).json({
        success: false,
        message: 'Champs obligatoires manquants',
        required: ['name', 'phone', 'password', 'location']
      });
    }
    
    // ✅ Validation conditionnelle : businessName requis pour les professionnels
    if (businessType === 'professional' && !businessName) {
      return res.status(400).json({
        success: false,
        message: 'Le nom de l\'activité est obligatoire pour un compte professionnel'
      });
    }

    // ✅ Vérifier si le phone existe déjà
    let existingUser = await User.findOne({ phone }).select('+otp');
    
    if (existingUser) {
      // Si l'utilisateur est actif, c'est une vraie inscription existante
      if (existingUser.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Ce numéro de téléphone est déjà enregistré'
        });
      }
      
      // Si l'utilisateur est inactif (utilisateur temporaire créé lors du sendOTP)
      // Vérifier que l'OTP a été vérifié
      if (!existingUser.otp || !existingUser.otp.verified) {
        return res.status(400).json({
          success: false,
          message: 'Veuillez d\'abord vérifier votre numéro de téléphone'
        });
      }
      
      // 📤 Upload avatar sur Cloudinary si fourni
      let avatarUrl = null;
      if (avatar) {
        avatarUrl = await uploadImage(avatar, 'kowa/avatars', `user_${phone.replace(/\s+/g, '')}`);
      }
      
      // ✅ Définir businessName par défaut pour les comptes individuels
      const finalBusinessName = businessName || (businessType === 'individual' ? name : '');
      
      // ✅ Mettre à jour l'utilisateur temporaire avec les vraies données
      existingUser.name = name;
      existingUser.password = password;  // Sera hashé par le pre-save hook
      existingUser.email = email || undefined;
      existingUser.businessType = businessType || 'individual';
      existingUser.businessName = finalBusinessName;
      existingUser.description = description || '';
      existingUser.location = location;
      existingUser.avatar = avatarUrl;
      existingUser.contactInfo = {
        whatsapp: whatsapp || phone
      };
      existingUser.isActive = true;  // Activer le compte
      existingUser.verified = true;  // Déjà vérifié via OTP
      
      await existingUser.save();
      
      // 🔑 Générer les tokens
      const accessToken = generateAccessToken(existingUser._id);
      const refreshToken = generateRefreshToken(existingUser._id);
      
      existingUser.refreshToken = refreshToken;
      await existingUser.save();
      
      return res.status(201).json({
        success: true,
        message: 'Inscription réussie',
        data: {
          user: {
            id: existingUser._id,
            name: existingUser.name,
            phone: existingUser.phone,
            email: existingUser.email,
            avatar: existingUser.avatar,
            businessName: existingUser.businessName,
            businessType: existingUser.businessType,
            location: existingUser.location,
            role: existingUser.role,
            verified: existingUser.verified
          },
          tokens: {
            accessToken,
            refreshToken
          }
        }
      });
    }

    const normalizedEmail = email ? normalizeEmail(email) : '';

    // ✅ Vérifier si l'email existe déjà (si fourni)
    if (normalizedEmail) {
      const emailExists = await User.findOne({ email: normalizedEmail });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà enregistré'
        });
      }
    }

    // ✅ Validation du mot de passe
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 6 caractères'
      });
    }

    // 📤 Upload avatar sur Cloudinary si fourni
    let avatarUrl = null;
    if (avatar) {
      avatarUrl = await uploadImage(avatar, 'kowa/avatars', `user_${phone.replace(/\s+/g, '')}`);
    }
    
    // ✅ Définir businessName par défaut pour les comptes individuels
    const finalBusinessName = businessName || (businessType === 'individual' ? name : '');

    // ✅ Créer l'utilisateur
    const user = await User.create({
      name,
      phone,
      email: normalizedEmail || undefined,
      password,  // Sera hashé par le pre-save hook
      businessType: businessType || 'individual',
      businessName: finalBusinessName,
      description: description || '',
      location,
      avatar: avatarUrl,
      contactInfo: {
        whatsapp: whatsapp || phone  // Par défaut = phone principal
      },
      role: 'seller'  // Inscription = vendeur par défaut
    });

    // 🔑 Générer les tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // 💾 Sauvegarder le refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // ✅ Réponse succès
    res.status(201).json({
      success: true,
      message: 'Inscription réussie',
      data: {
        user: user.toAuthJSON(),
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'inscription',
      error: error.message
    });
  }
};

// ===============================================
// 🔐 CONNEXION (Login)
// ===============================================
// @desc    Connexion utilisateur (phone OU email + password)
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { loginType, phone, email, password } = req.body;
    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);

    console.log('🔐 Tentative de connexion:');
    console.log('  - Type:', loginType);
    console.log('  - Phone:', phone);
    console.log('  - Email:', email);
    console.log('  - Password:', password ? '***' : 'ABSENT');

    // ✅ Validation
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe est requis'
      });
    }

    if (!loginType || (loginType !== 'phone' && loginType !== 'email')) {
      return res.status(400).json({
        success: false,
        message: 'Type de connexion invalide (phone ou email)'
      });
    }

    if (loginType === 'phone' && !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: 'Le numéro de téléphone est requis'
      });
    }

    if (loginType === 'email' && !normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'L\'email est requis'
      });
    }

    // 🔍 Trouver l'utilisateur (avec password)
    let user;
    if (loginType === 'phone') {
      console.log('🔍 Recherche utilisateur par téléphone:', normalizedPhone);
      user = await User.findOne({ phone: normalizedPhone }).select('+password');
    } else {
      console.log('🔍 Recherche utilisateur par email:', normalizedEmail);
      const emailRegex = new RegExp(`^${escapeRegExp(normalizedEmail)}$`, 'i');
      user = await User.findOne({ email: emailRegex }).select('+password');
    }

    console.log('👤 Utilisateur trouvé:', user ? 'OUI' : 'NON');
    if (user) {
      console.log('📱 Phone dans DB:', user.phone);
      console.log('📧 Email dans DB:', user.email);
      console.log('🔓 isActive:', user.isActive);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Identifiants incorrects'
      });
    }

    // ✅ Vérifier le compte actif
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Votre compte a été désactivé. Contactez l\'administrateur.'
      });
    }

    // ✅ Vérifier le mot de passe
    const isPasswordValid = await user.comparePassword(password);
    console.log('🔐 Mot de passe valide:', isPasswordValid ? 'OUI' : 'NON');
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Identifiants incorrects'
      });
    }

    // 🔑 Générer les tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // 💾 Sauvegarder le refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // ✅ Réponse succès
    res.status(200).json({
      success: true,
      message: 'Connexion réussie',
      data: {
        user: user.toAuthJSON(),
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la connexion',
      error: error.message
    });
  }
};

// ===============================================
// 🔄 REFRESH TOKEN
// ===============================================
// @desc    Rafraîchir l'access token avec un refresh token
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token manquant'
      });
    }

    // ✅ Vérifier le refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_key_2026'
    );

    // 🔍 Trouver l'utilisateur
    const user = await User.findById(decoded.id).select('+refreshToken');
    
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalide'
      });
    }

    // 🔑 Générer nouveau access token
    const newAccessToken = generateAccessToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken
      }
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Refresh token expiré ou invalide'
    });
  }
};

// ===============================================
// 🚪 DÉCONNEXION (Logout)
// ===============================================
// @desc    Déconnexion utilisateur
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    // req.user est ajouté par le middleware protect
    const user = await User.findById(req.user.id);
    
    if (user) {
      user.refreshToken = null;
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: 'Déconnexion réussie'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la déconnexion'
    });
  }
};

// ===============================================
// 👤 OBTENIR PROFIL
// ===============================================
// @desc    Obtenir les infos de l'utilisateur connecté
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        user: user.toAuthJSON()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil'
    });
  }
};

// ===============================================
// 📝 UPDATE PROFIL
// ===============================================
// @desc    Mettre à jour profil utilisateur (nom, ville, avatar)
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, city, avatar, email, description, businessType, businessName, whatsapp } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    if (typeof name === 'string' && name.trim()) {
      user.name = name.trim();
    }

    // Le schéma User stocke la ville dans "location".
    if (typeof city === 'string' && city.trim()) {
      user.location = city.trim();
    }

    if (typeof avatar === 'string' && avatar.trim()) {
      user.avatar = avatar.trim();
    }

    // ✉️ Email (vérifier unicité si changé)
    if (typeof email === 'string') {
      const trimmedEmail = email.trim().toLowerCase();
      if (trimmedEmail && trimmedEmail !== (user.email || '')) {
        const emailExists = await User.findOne({ email: trimmedEmail, _id: { $ne: user._id } });
        if (emailExists) {
          return res.status(400).json({
            success: false,
            message: 'Cet email est déjà utilisé par un autre compte'
          });
        }
        user.email = trimmedEmail;
      } else if (!trimmedEmail) {
        user.email = undefined;
      }
    }

    // 📝 Description / Bio
    if (typeof description === 'string') {
      user.description = description.trim();
    }

    // 🏢 Type de compte
    if (businessType && ['individual', 'professional'].includes(businessType)) {
      user.businessType = businessType;
    }

    // 🏢 Nom de l'activité
    if (typeof businessName === 'string') {
      if (user.businessType === 'professional' && !businessName.trim()) {
        return res.status(400).json({
          success: false,
          message: "Le nom de l'activité est obligatoire pour un compte professionnel"
        });
      }
      user.businessName = businessName.trim();
    }

    // 📱 WhatsApp
    if (typeof whatsapp === 'string') {
      if (!user.contactInfo) user.contactInfo = {};
      user.contactInfo.whatsapp = whatsapp.trim();
    }

    // Si l'utilisateur complète son profil, désactiver isMinimalAccount
    if (user.isMinimalAccount && user.location && user.name) {
      user.isMinimalAccount = false;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profil mis à jour avec succès',
      data: {
        user: user.toAuthJSON()
      }
    });
  } catch (error) {
    console.error('❌ Erreur mise à jour profil:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du profil'
    });
  }
};
// ===============================================
// 🔐 RÉINITIALISATION MOT DE PASSE
// ===============================================
// @desc    Demander code de réinitialisation
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { identifier } = req.body; // Peut être email ou phone

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Email ou numéro de téléphone requis'
      });
    }

    // 🔍 Détecter si c'est un email ou un téléphone
    const trimmedIdentifier = String(identifier || '').trim();
    const isEmail = trimmedIdentifier.includes('@');
    const normalizedIdentifier = isEmail
      ? normalizeEmail(trimmedIdentifier)
      : normalizePhone(trimmedIdentifier);
    
    // Chercher l'utilisateur
    const user = await User.findOne(
      isEmail ? { email: normalizedIdentifier } : { phone: normalizedIdentifier }
    );

    // ❌ Vérifier si l'utilisateur existe
    if (!user) {
      return res.status(404).json({
        success: false,
        message: isEmail 
          ? 'Aucun compte associé à cet email' 
          : 'Aucun compte associé à ce numéro de téléphone'
      });
    }

    // 🎲 Générer code OTP (6 chiffres)
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    // 💾 Sauvegarder le code OTP dans la base de données
    user.otp = {
      code: resetCode,
      expiresAt: otpExpiry,
      verified: false,
      attempts: (user.otp?.attempts || 0) + 1,
      lastAttempt: new Date()
    };
    await user.save();

    // TODO: Envoyer le code par SMS (si téléphone) ou email (si email)
    console.log(`📧 Code de réinitialisation pour ${normalizedIdentifier}:`, resetCode);

    res.status(200).json({
      success: true,
      message: `Code de réinitialisation envoyé à ${isEmail ? 'votre email' : 'votre téléphone'}`,
      // DEMO ONLY - À supprimer en production
      devCode: process.env.NODE_ENV === 'development' ? resetCode : undefined
    });

  } catch (error) {
    console.error('❌ Erreur forgot-password:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la demande de réinitialisation'
    });
  }
};

// @desc    Vérifier le code de réinitialisation
// @route   POST /api/auth/verify-reset-code
// @access  Public
exports.verifyResetCode = async (req, res) => {
  try {
    const { identifier, code } = req.body;

    // ✅ Validation des champs
    if (!identifier || !code) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant et code requis'
      });
    }

    // 🔍 Détecter si c'est un email ou un téléphone
    const trimmedIdentifier = String(identifier || '').trim();
    const isEmail = trimmedIdentifier.includes('@');
    const normalizedIdentifier = isEmail
      ? normalizeEmail(trimmedIdentifier)
      : normalizePhone(trimmedIdentifier);
    
    // Chercher l'utilisateur
    const user = await User.findOne(
      isEmail ? { email: normalizedIdentifier } : { phone: normalizedIdentifier }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // 🔐 Vérifier le code OTP
    if (!user.otp || !user.otp.code) {
      return res.status(400).json({
        success: false,
        message: 'Aucun code de réinitialisation trouvé. Veuillez en demander un nouveau.'
      });
    }

    // ⏰ Vérifier si le code a expiré
    if (new Date() > user.otp.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Le code a expiré. Veuillez en demander un nouveau.'
      });
    }

    // 🔍 Vérifier si le code correspond
    if (user.otp.code !== code) {
      return res.status(400).json({
        success: false,
        message: 'Code invalide'
      });
    }

    // ✅ Code valide
    console.log(`✅ Code vérifié avec succès pour: ${normalizedIdentifier}`);

    res.status(200).json({
      success: true,
      message: 'Code vérifié avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur verify-reset-code:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du code'
    });
  }
};

// @desc    Réinitialiser le mot de passe
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { identifier, code, newPassword } = req.body;

    // ✅ Validation des champs
    if (!identifier || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont requis (identifier, code, newPassword)'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 6 caractères'
      });
    }

    // 🔍 Détecter si c'est un email ou un téléphone
    const trimmedIdentifier = String(identifier || '').trim();
    const isEmail = trimmedIdentifier.includes('@');
    const normalizedIdentifier = isEmail
      ? normalizeEmail(trimmedIdentifier)
      : normalizePhone(trimmedIdentifier);
    
    // Chercher l'utilisateur
    const user = await User.findOne(
      isEmail ? { email: normalizedIdentifier } : { phone: normalizedIdentifier }
    ).select('+password'); // Inclure le mot de passe pour le modifier

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // 🔐 Vérifier le code OTP
    if (!user.otp || !user.otp.code) {
      return res.status(400).json({
        success: false,
        message: 'Aucun code de réinitialisation trouvé. Veuillez en demander un nouveau.'
      });
    }

    // ⏰ Vérifier si le code a expiré
    if (new Date() > user.otp.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Le code a expiré. Veuillez en demander un nouveau.'
      });
    }

    // 🔍 Vérifier si le code correspond
    if (user.otp.code !== code) {
      return res.status(400).json({
        success: false,
        message: 'Code invalide'
      });
    }

    // ✅ Mettre à jour le mot de passe
    user.password = newPassword;
    
    // 🗑️ Supprimer l'OTP utilisé
    user.otp = undefined;
    
    await user.save();

    console.log(`✅ Mot de passe réinitialisé pour: ${normalizedIdentifier}`);

    res.status(200).json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur reset-password:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la réinitialisation du mot de passe'
    });
  }
};

// ===============================================
// 📱 ENVOYER OTP (INSCRIPTION UNIQUEMENT)
// ===============================================
// @desc    Envoyer code OTP pour inscription uniquement
// @route   POST /api/auth/send-otp
// @access  Public
// @note    Pour réinitialisation mot de passe, utiliser /api/auth/forgot-password
exports.sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    console.log('📱 Demande OTP reçue:', { phone, body: req.body });

    if (!phone) {
      console.log('❌ Téléphone manquant');
      return res.status(400).json({
        success: false,
        message: 'Le numéro de téléphone est requis'
      });
    }

    // Validation du format du numéro de téléphone
    const phoneRegex = /^\+\d{1,4}\s\d{6,}$/;
    const trimmedPhone = phone.trim();
    
    console.log('🔍 Validation téléphone:', { 
      phone, 
      trimmedPhone, 
      matches: phoneRegex.test(trimmedPhone) 
    });
    
    if (!phoneRegex.test(trimmedPhone)) {
      console.log('❌ Format téléphone invalide');
      return res.status(400).json({
        success: false,
        message: 'Format de numéro de téléphone invalide. Exemple: +227 12345678'
      });
    }

    // 🔍 Chercher si un utilisateur avec ce numéro existe
    let user = await User.findOne({ phone });
    
    // 🔐 VÉRIFICATION - Pour inscription seulement
    // Si un utilisateur actif existe déjà, interdire
    if (user && user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Ce numéro de téléphone est déjà utilisé'
      });
    }
    
    const now = new Date();
    const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
    const COOLDOWN_BETWEEN_ATTEMPTS = 60 * 1000; // 60 secondes
    const MAX_ATTEMPTS = 3;
    
    if (user && user.otp) {
      // 🚫 Vérifier le nombre de tentatives
      const timeSinceFirstAttempt = user.otp.lastAttempt 
        ? now - user.otp.lastAttempt 
        : RATE_LIMIT_WINDOW + 1;
      
      // Réinitialiser le compteur si la fenêtre de 15 min est passée
      if (timeSinceFirstAttempt > RATE_LIMIT_WINDOW) {
        user.otp.attempts = 0;
      }
      
      // Vérifier si l'utilisateur a dépassé le nombre max de tentatives
      if (user.otp.attempts >= MAX_ATTEMPTS && timeSinceFirstAttempt <= RATE_LIMIT_WINDOW) {
        const remainingTime = Math.ceil((RATE_LIMIT_WINDOW - timeSinceFirstAttempt) / 60000);
        return res.status(429).json({
          success: false,
          message: `Trop de tentatives. Veuillez réessayer dans ${remainingTime} minute(s).`,
          remainingMinutes: remainingTime
        });
      }
      
      // ⏱️ Vérifier le cooldown entre les tentatives (anti-spam)
      if (user.otp.lastAttempt) {
        const timeSinceLastAttempt = now - user.otp.lastAttempt;
        if (timeSinceLastAttempt < COOLDOWN_BETWEEN_ATTEMPTS) {
          const remainingSeconds = Math.ceil((COOLDOWN_BETWEEN_ATTEMPTS - timeSinceLastAttempt) / 1000);
          return res.status(429).json({
            success: false,
            message: `Veuillez attendre ${remainingSeconds} secondes avant de renvoyer un code.`,
            remainingSeconds: remainingSeconds
          });
        }
      }
    }
    
    // 🎲 Générer code OTP (6 chiffres)
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    if (user) {
      // Mettre à jour l'OTP pour l'utilisateur existant (inactif, en cours d'inscription)
      user.otp = {
        code: otpCode,
        expiresAt: otpExpiry,
        verified: false,
        attempts: (user.otp?.attempts || 0) + 1,
        lastAttempt: now
      };
      await user.save();
    } else {
      // 🆕 Créer un utilisateur temporaire pour l'inscription
      // Cet utilisateur sera complété lors du register final
      user = await User.create({
        phone,
        otp: {
          code: otpCode,
          expiresAt: otpExpiry,
          verified: false,
          attempts: 1,
          lastAttempt: now
        },
        // Champs temporaires - seront mis à jour lors du register
        name: 'Temp User',
        password: 'temp_password_will_be_updated',
        businessName: 'Temp Business',
        location: 'Temp Location',
        businessType: 'individual',
        isActive: false // Marquer comme inactif jusqu'à inscription complète
      });
    }
    
    // 📤 ENVOYER LE SMS (À IMPLÉMENTER)
    // TODO: Intégrer un provider SMS (Twilio, Vonage, AfricasTalking, etc.)
    // await sendSMS(phone, `Votre code de vérification: ${otpCode}`);
    
    console.log(`📱 OTP envoyé au ${phone}: ${otpCode}`);

    res.status(200).json({
      success: true,
      message: 'Code de vérification envoyé',
      data: {
        attemptsRemaining: MAX_ATTEMPTS - user.otp.attempts,
        totalAttempts: MAX_ATTEMPTS,
        cooldownSeconds: 60
      },
      // ⚠️ EN DÉVELOPPEMENT SEULEMENT - À supprimer en production
      ...(process.env.NODE_ENV === 'development' && { 
        devOTP: otpCode,
        devExpiresIn: '10 minutes'
      })
    });

  } catch (error) {
    console.error('Erreur envoi OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du code'
    });
  }
};

// ===============================================
// ✅ VÉRIFIER OTP
// ===============================================
// @desc    Vérifier le code OTP
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyOTP = async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({
        success: false,
        message: 'Le numéro de téléphone et le code sont requis'
      });
    }

    // 🔍 Trouver l'utilisateur
    const user = await User.findOne({ phone });

    console.log('🔍 Utilisateur trouvé:', user ? 'Oui' : 'Non');
    console.log('🔍 OTP présent:', user?.otp ? 'Oui' : 'Non');
    console.log('🔍 Code OTP dans DB:', user?.otp?.code);
    console.log('🔍 Code reçu:', code);

    if (!user || !user.otp || !user.otp.code) {
      return res.status(400).json({
        success: false,
        message: 'Code de vérification invalide ou expiré'
      });
    }

    // ⏰ Vérifier l'expiration
    if (new Date() > user.otp.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Code de vérification expiré. Demandez un nouveau code.'
      });
    }

    // ✅ Vérifier le code
    if (user.otp.code !== code) {
      return res.status(400).json({
        success: false,
        message: 'Code de vérification incorrect'
      });
    }

    // 🎉 Code valide - Marquer comme vérifié
    user.otp.verified = true;
    user.verified = true;  // Marquer le compte comme vérifié
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Numéro vérifié avec succès',
      data: {
        verified: true
      }
    });

  } catch (error) {
    console.error('Erreur vérification OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du code'
    });
  }
};

// ===============================================
// 👤 PROFIL PUBLIC VENDEUR
// ===============================================
// @desc    Obtenir le profil public d'un vendeur
// @route   GET /api/auth/seller/:id
// @access  Public
exports.getSellerProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Vendeur introuvable'
      });
    }

    const sellerProducts = await Product.find({ seller: user._id, status: 'active' })
      .select('rating totalReviews type');

    const totalListings = sellerProducts.length;
    const totalReviewsFromProducts = sellerProducts.reduce((sum, product) => sum + (Number(product.totalReviews) || 0), 0);
    const weightedRatingTotal = sellerProducts.reduce((sum, product) => {
      const productRating = Number(product.rating) || 0;
      const productReviews = Number(product.totalReviews) || 0;
      return sum + (productRating * productReviews);
    }, 0);
    const computedRating = totalReviewsFromProducts > 0
      ? weightedRatingTotal / totalReviewsFromProducts
      : Number(user.sellerStats?.rating) || 0;

    const sellerJson = await user.toSellerJSON(totalListings);

    sellerJson.rating = computedRating;
    sellerJson.totalReviews = totalReviewsFromProducts > 0
      ? totalReviewsFromProducts
      : Number(user.sellerStats?.totalReviews) || 0;
    sellerJson.totalListings = totalListings;

    res.status(200).json({
      success: true,
      data: sellerJson
    });

  } catch (error) {
    console.error('❌ Erreur récupération profil vendeur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil',
      error: error.message
    });
  }
};

// ===============================================
// 📱 VÉRIFIER NUMÉRO DE TÉLÉPHONE (Mode 1)
// ===============================================
// @desc    Vérifier si un numéro de téléphone est déjà enregistré
// @route   POST /api/auth/check-phone
// @access  Public
exports.checkPhone = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Le numéro de téléphone est requis'
      });
    }

    // Chercher un utilisateur actif avec ce numéro
    const user = await User.findOne({ phone, isActive: true });

    res.status(200).json({
      success: true,
      data: {
        exists: !!user
      }
    });

  } catch (error) {
    console.error('❌ Erreur check-phone:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du numéro'
    });
  }
};

// ===============================================
// 🚀 INSCRIPTION RAPIDE (Mode 1 — contextuel)
// ===============================================
// @desc    Inscription minimale : nom + phone (OTP déjà vérifié)
// @route   POST /api/auth/quick-register
// @access  Public
exports.quickRegister = async (req, res) => {
  try {
    const { name, phone } = req.body;

    // ✅ Validation
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Nom et numéro de téléphone requis'
      });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Le nom doit contenir au moins 2 caractères'
      });
    }

    // 🔍 Chercher l'utilisateur temporaire (créé par sendOTP)
    let user = await User.findOne({ phone });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Veuillez d\'abord vérifier votre numéro de téléphone'
      });
    }

    // Vérifier si c'est un utilisateur déjà actif
    if (user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Ce numéro de téléphone est déjà enregistré. Veuillez vous connecter.'
      });
    }

    // Vérifier que l'OTP a été vérifié
    if (!user.otp || !user.otp.verified) {
      return res.status(400).json({
        success: false,
        message: 'Veuillez d\'abord vérifier votre numéro de téléphone'
      });
    }

    // 🎲 Générer un mot de passe temporaire (8 caractères)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let tempPassword = '';
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    console.log(`📱 Mot de passe temporaire pour ${phone}: ${tempPassword}`);

    // ✅ Mettre à jour l'utilisateur temporaire
    user.name = name.trim();
    user.password = tempPassword; // Sera hashé par le pre-save hook
    user.isActive = true;
    user.verified = true;
    user.needsPasswordChange = true;
    user.isMinimalAccount = true;
    user.location = '';
    user.businessType = 'individual';
    user.businessName = name.trim();
    user.contactInfo = {
      whatsapp: phone
    };

    await user.save();

    // 🔑 Générer les tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    // TODO: Envoyer le mot de passe temporaire par SMS
    // await sendSMS(phone, `Votre mot de passe temporaire MarketHub: ${tempPassword}. Changez-le dans votre profil.`);

    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      data: {
        user: user.toAuthJSON(),
        tokens: {
          accessToken,
          refreshToken
        }
      },
      // ⚠️ EN DÉVELOPPEMENT SEULEMENT
      ...(process.env.NODE_ENV === 'development' && {
        devTempPassword: tempPassword
      })
    });

  } catch (error) {
    console.error('❌ Erreur quick-register:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'inscription rapide',
      error: error.message
    });
  }
};

// ===============================================
// 🔐 CHANGER MOT DE PASSE (authentifié)
// ===============================================
// @desc    Changer le mot de passe (avec ou sans ancien mot de passe)
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Le nouveau mot de passe est requis'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 6 caractères'
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // Si l'utilisateur doit changer son mot de passe (compte Mode 1),
    // on ne demande pas l'ancien mot de passe
    if (!user.needsPasswordChange) {
      // Sinon, vérifier l'ancien mot de passe
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Le mot de passe actuel est requis'
        });
      }

      const isValid = await user.comparePassword(currentPassword);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: 'Mot de passe actuel incorrect'
        });
      }
    }

    // ✅ Mettre à jour le mot de passe
    user.password = newPassword; // Sera hashé par le pre-save hook
    user.needsPasswordChange = false;
    await user.save();

    console.log(`✅ Mot de passe changé pour: ${user.phone}`);

    res.status(200).json({
      success: true,
      message: 'Mot de passe modifié avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur change-password:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du changement de mot de passe'
    });
  }
};
