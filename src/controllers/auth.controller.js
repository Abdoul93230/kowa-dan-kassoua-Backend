const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { uploadImage } = require('../utils/uploadImage');

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
    if (!name || !phone || !password || !businessName || !location) {
      return res.status(400).json({
        success: false,
        message: 'Champs obligatoires manquants',
        required: ['name', 'phone', 'password', 'businessName', 'location']
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
      
      // ✅ Mettre à jour l'utilisateur temporaire avec les vraies données
      existingUser.name = name;
      existingUser.password = password;  // Sera hashé par le pre-save hook
      existingUser.email = email || undefined;
      existingUser.businessType = businessType || 'individual';
      existingUser.businessName = businessName;
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

    // ✅ Vérifier si l'email existe déjà (si fourni)
    if (email) {
      const emailExists = await User.findOne({ email });
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

    // ✅ Créer l'utilisateur
    const user = await User.create({
      name,
      phone,
      email: email || undefined,
      password,  // Sera hashé par le pre-save hook
      businessType: businessType || 'individual',
      businessName,
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
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          avatar: user.avatar,
          businessName: user.businessName,
          businessType: user.businessType,
          location: user.location,
          role: user.role,
          verified: user.verified,
          memberSince: user.memberSince
        },
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

    if (loginType === 'phone' && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Le numéro de téléphone est requis'
      });
    }

    if (loginType === 'email' && !email) {
      return res.status(400).json({
        success: false,
        message: 'L\'email est requis'
      });
    }

    // 🔍 Trouver l'utilisateur (avec password)
    let user;
    if (loginType === 'phone') {
      console.log('🔍 Recherche utilisateur par téléphone:', phone);
      user = await User.findOne({ phone }).select('+password');
    } else {
      console.log('🔍 Recherche utilisateur par email:', email);
      user = await User.findOne({ email }).select('+password');
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
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          avatar: user.avatar,
          businessName: user.businessName,
          businessType: user.businessType,
          location: user.location,
          role: user.role,
          verified: user.verified,
          sellerStats: user.sellerStats,
          memberSince: user.memberSince
        },
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
        user: user.toSellerJSON()  // Format frontend Seller
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
    const isEmail = identifier.includes('@');
    
    // Chercher l'utilisateur
    const user = await User.findOne(
      isEmail ? { email: identifier } : { phone: identifier }
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
    console.log(`📧 Code de réinitialisation pour ${identifier}:`, resetCode);

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
    const isEmail = identifier.includes('@');
    
    // Chercher l'utilisateur
    const user = await User.findOne(
      isEmail ? { email: identifier } : { phone: identifier }
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
    console.log(`✅ Code vérifié avec succès pour: ${identifier}`);

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
    const isEmail = identifier.includes('@');
    
    // Chercher l'utilisateur
    const user = await User.findOne(
      isEmail ? { email: identifier } : { phone: identifier }
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

    console.log(`✅ Mot de passe réinitialisé pour: ${identifier}`);

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

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Le numéro de téléphone est requis'
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
