const Product = require('../models/Product');
const Category = require('../models/Category');
const { uploadMultipleImages, deleteImage } = require('../utils/uploadImage');

// ===============================================
// 🔄 FONCTIONS UTILITAIRES POUR LES STATS
// ===============================================

/**
 * Mettre à jour les statistiques d'une catégorie
 * @param {ObjectId} categoryId - ID de la catégorie
 */
const updateCategoryStats = async (categoryId) => {
  try {
    if (!categoryId) return;
    
    const category = await Category.findById(categoryId);
    if (!category) return;
    
    // Compter les produits et services actifs
    const productsCount = await Product.countDocuments({
      category: categoryId,
      type: 'product',
      status: 'active'
    });
    
    const servicesCount = await Product.countDocuments({
      category: categoryId,
      type: 'service',
      status: 'active'
    });
    
    // Mettre à jour les stats
    category.productsCount = productsCount;
    category.servicesCount = servicesCount;
    await category.save();
    
    console.log(`📊 Stats catégorie "${category.name}" mises à jour: ${productsCount} produits, ${servicesCount} services`);
  } catch (error) {
    console.error('❌ Erreur mise à jour stats catégorie:', error);
  }
};

// ===============================================
// ➕ CRÉER UN PRODUIT/SERVICE
// ===============================================
// @desc    Créer une nouvelle annonce
// @route   POST /api/products
// @access  Private (authentifié)
exports.createProduct = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      subcategory,
      type,
      price,
      location,
      condition,
      quantity,
      delivery,
      availability,
      serviceArea,
      specifications,
      promoted,
      featured
    } = req.body;

    // ✅ Validation des champs obligatoires
    if (!title || !description || !category || !price) {
      return res.status(400).json({
        success: false,
        message: 'Champs obligatoires manquants : title, description, category, price'
      });
    }

    // 📍 Si pas de localisation fournie, utiliser celle du profil du vendeur
    const User = require('../models/User');
    const seller = await User.findById(req.user.id);
    let productLocation = location || seller.location;

    if (!productLocation) {
      return res.status(400).json({
        success: false,
        message: 'La localisation est requise. Veuillez mettre à jour votre profil.'
      });
    }

    // ✅ Normaliser le format de localisation pour garantir "Ville, Pays"
    // Si la localisation ne contient pas de virgule, ajouter ", Niger" par défaut
    if (!productLocation.includes(',')) {
      productLocation = `${productLocation}, Niger`;
    }

    // 📸 Validation des images
    const images = req.body.images; // Array de base64 depuis le frontend
    if (!images || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Au moins une image est requise'
      });
    }

    if (images.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 10 images autorisées'
      });
    }

    console.log('📤 Upload de', images.length, 'images vers Cloudinary...');

    // 🌩️ Upload des images sur Cloudinary
    const uploadedImages = await uploadMultipleImages(
      images,
      'products',
      `product_${req.user.id}_${Date.now()}`
    );

    console.log('✅ Images uploadées:', uploadedImages.length);

    // � Récupérer le slug de la catégorie
    const Category = require('../models/Category');
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        message: 'Catégorie invalide'
      });
    }

    // 📦 Créer le produit
    const product = await Product.create({
      seller: req.user.id,
      title,
      description,
      category,
      categorySlug: categoryDoc.slug,
      subcategory: subcategory || '',
      subcategorySlug: subcategory ? subcategory.toLowerCase().replace(/\s+/g, '-') : '',
      type: type || 'product',
      price,
      location: productLocation,
      condition: condition || 'used',
      quantity: quantity || '1',
      images: uploadedImages,
      mainImage: uploadedImages[0], // Première image = image principale
      delivery: delivery || { available: false },
      availability: availability || { days: [], openingTime: '', closingTime: '' },
      serviceArea: serviceArea || [],
      specifications: specifications || {},
      promoted: promoted || false,
      featured: featured || false,
      status: 'active'
    });

    console.log('✅ Produit créé avec succès:', product._id);

    // � Mettre à jour les statistiques de la catégorie
    await updateCategoryStats(product.category);

    // �🔄 Populer le vendeur et retourner au format Item
    await product.populate('seller');
    const productJSON = await product.toItemJSON();

    res.status(201).json({
      success: true,
      message: 'Annonce créée avec succès',
      data: productJSON
    });

  } catch (error) {
    console.error('❌ Erreur création produit:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'annonce',
      error: error.message
    });
  }
};

// ===============================================
// 📋 OBTENIR TOUS LES PRODUITS (avec filtres)
// ===============================================
// @desc    Liste des produits avec pagination et filtres
// @route   GET /api/products?page=1&limit=10&category=...&search=...
// @access  Public
exports.getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      categorySlug,
      subcategory,
      type,
      condition,
      location,
      search,
      minPrice,
      maxPrice,
      seller,
      status = 'active',
      sort = '-createdAt' // Par défaut : plus récents
    } = req.query;

    // 🔍 Gestion de la catégorie : accepter slug ou ObjectId
    let categoryFilter = null;
    if (categorySlug) {
      // Si categorySlug fourni, filtrer par slug
      categoryFilter = { categorySlug };
    } else if (category) {
      // Si category fourni, vérifier si c'est un ObjectId ou un slug
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(category) && /^[0-9a-fA-F]{24}$/.test(category)) {
        // C'est un ObjectId
        categoryFilter = { category };
      } else {
        // C'est un slug
        categoryFilter = { categorySlug: category };
      }
    }

    // 🔍 Filtrage par localisation : chercher dans product.location OU seller.location
    // Utilisation d'agrégation MongoDB pour filtrer par localisation du vendeur
    if (location) {
      const User = require('../models/User');
      const locationRegex = new RegExp(location, 'i');
      
      // Étape 1: Trouver les IDs des vendeurs dans cette localisation
      const sellersInLocation = await User.find(
        { location: locationRegex },
        { _id: 1 }
      );
      const sellerIds = sellersInLocation.map(s => s._id);
      
      // Étape 2: Construire les filtres de base
      const filter = { status };
      if (categoryFilter) Object.assign(filter, categoryFilter);
      if (subcategory) filter.subcategory = subcategory;
      if (type) filter.type = type;
      if (condition) filter.condition = condition;
      if (seller) filter.seller = seller;
      
      // Étape 3: Filtrer par produits avec location OU vendeurs dans cette localisation
      filter.$or = [
        { location: locationRegex },
        { seller: { $in: sellerIds } }
      ];
      
      // 🔎 Recherche par texte (titre + description) - regex pour correspondances partielles
      if (search) {
        const searchRegex = new RegExp(search, 'i');
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { title: searchRegex },
            { description: searchRegex }
          ]
        });
      }
      
      // 📊 Exécuter la requête avec filtre de localisation
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [products, total] = await Promise.all([
        Product.find(filter)
          .populate('seller', 'name avatar phone email whatsapp businessType businessName rating totalSales location')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit)),
        Product.countDocuments(filter)
      ]);
      
      // 🔄 Transformer en format Item
      const productsJSON = await Promise.all(
        products.map(product => product.toItemJSON())
      );

      return res.status(200).json({
        success: true,
        data: productsJSON,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    }
    
    // 🔍 Si pas de filtre localisation, utiliser le filtre classique
    const filter = { status };

    if (categoryFilter) Object.assign(filter, categoryFilter);
    if (subcategory) filter.subcategory = subcategory;
    if (type) filter.type = type;
    if (condition) filter.condition = condition;
    if (seller) filter.seller = seller;

    // 🔎 Recherche par texte (titre + description) - regex pour correspondances partielles
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { title: searchRegex },
        { description: searchRegex }
      ];
    }

    // 💰 Filtrage par prix (conversion string → number)
    if (minPrice || maxPrice) {
      // Note: Prix stocké en string, nécessite conversion côté frontend
      // ou utilisation de MongoDB aggregation pour conversion
    }

    // 📊 Exécuter la requête
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('seller', 'name avatar phone email whatsapp businessType businessName rating totalSales location')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Product.countDocuments(filter)
    ]);

    // 🔄 Transformer en format Item
    const productsJSON = await Promise.all(
      products.map(product => product.toItemJSON())
    );

    res.status(200).json({
      success: true,
      data: productsJSON,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération produits:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits',
      error: error.message
    });
  }
};

// ===============================================
// 🔍 OBTENIR UN PRODUIT PAR ID
// ===============================================
// @desc    Détails d'un produit
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('seller', 'name avatar phone email whatsapp businessType businessName description location rating totalSales memberSince');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // � Vérifier si le produit est actif
    // Si l'utilisateur n'est pas le vendeur et que le produit n'est pas actif, refuser l'accès
    const isOwner = req.user && product.seller._id.toString() === req.user.id;
    
    if (!isOwner && product.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Cette annonce n\'est plus disponible'
      });
    }

    // 📈 Incrémenter les vues (seulement si actif ou si propriétaire)
    if (product.status === 'active' || isOwner) {
      await product.incrementViews();
    }

    // 🔄 Transformer en format Item
    const productJSON = await product.toItemJSON();

    res.status(200).json({
      success: true,
      data: productJSON
    });

  } catch (error) {
    console.error('❌ Erreur récupération produit:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du produit',
      error: error.message
    });
  }
};

// ===============================================
// 📝 MODIFIER UN PRODUIT
// ===============================================
// @desc    Mettre à jour une annonce
// @route   PUT /api/products/:id
// @access  Private (propriétaire uniquement)
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // 🔒 Vérifier que l'utilisateur est le propriétaire
    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé : vous n\'êtes pas le propriétaire de cette annonce'
      });
    }

    const {
      title,
      description,
      category,
      subcategory,
      type,
      price,
      location,
      condition,
      quantity,
      delivery,
      availability,
      serviceArea,
      specifications,
      status,
      newImages, // Nouvelles images à ajouter (base64)
      deleteImages // URLs des images à supprimer
    } = req.body;

    // 🗑️ Supprimer les images demandées
    if (deleteImages && deleteImages.length > 0) {
      for (const imageUrl of deleteImages) {
        try {
          await deleteImage(imageUrl);
          product.images = product.images.filter(img => img !== imageUrl);
        } catch (err) {
          console.error('Erreur suppression image:', err);
        }
      }
    }

    // 📸 Ajouter de nouvelles images
    if (newImages && newImages.length > 0) {
      const uploadedImages = await uploadMultipleImages(
        newImages,
        'products',
        `product_${req.user.id}_${Date.now()}`
      );
      product.images.push(...uploadedImages);
    }

    // ✅ Validation : au moins 1 image
    if (product.images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Au moins une image est requise'
      });
    }

    // 📝 Mettre à jour les champs
    if (title) product.title = title;
    if (description) product.description = description;
    if (category) product.category = category;
    if (subcategory !== undefined) product.subcategory = subcategory;
    if (type) product.type = type;
    if (price) product.price = price;
    if (location) {
      // ✅ Normaliser le format de localisation pour garantir "Ville, Pays"
      let normalizedLocation = location;
      if (!normalizedLocation.includes(',')) {
        normalizedLocation = `${normalizedLocation}, Niger`;
      }
      product.location = normalizedLocation;
    }
    if (condition) product.condition = condition;
    if (quantity) product.quantity = quantity;
    if (delivery !== undefined) product.delivery = delivery;
    if (availability !== undefined) product.availability = availability;
    if (serviceArea !== undefined) product.serviceArea = serviceArea;
    if (specifications !== undefined) product.specifications = specifications;
    if (status) product.status = status;

    // 🖼️ Mettre à jour l'image principale si nécessaire
    if (!product.images.includes(product.mainImage)) {
      product.mainImage = product.images[0];
    }

    await product.save();
    await product.populate('seller');

    const productJSON = await product.toItemJSON();

    res.status(200).json({
      success: true,
      message: 'Annonce mise à jour avec succès',
      data: productJSON
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour produit:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de l\'annonce',
      error: error.message
    });
  }
};

// ===============================================
// 🗑️ SUPPRIMER UN PRODUIT
// ===============================================
// @desc    Supprimer une annonce
// @route   DELETE /api/products/:id
// @access  Private (propriétaire uniquement)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // 🔒 Vérifier que l'utilisateur est le propriétaire
    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé : vous n\'êtes pas le propriétaire de cette annonce'
      });
    }

    // 🗑️ Supprimer les images de Cloudinary
    for (const imageUrl of product.images) {
      try {
        await deleteImage(imageUrl);
      } catch (err) {
        console.error('Erreur suppression image:', err);
      }
    }

    // Sauvegarder la catégorie avant suppression pour mettre à jour les stats
    const categoryId = product.category;

    // 🗑️ Supprimer le produit
    await product.deleteOne();

    // 📊 Mettre à jour les statistiques de la catégorie
    await updateCategoryStats(categoryId);

    res.status(200).json({
      success: true,
      message: 'Annonce supprimée avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur suppression produit:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'annonce',
      error: error.message
    });
  }
};

// ===============================================
// 📦 MES ANNONCES (produits du vendeur connecté)
// ===============================================
// @desc    Obtenir mes annonces
// @route   GET /api/products/my/listings
// @access  Private
exports.getMyProducts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = { seller: req.user._id };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('seller')
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit)),
      Product.countDocuments(filter)
    ]);

    const productsJSON = await Promise.all(
      products.map(product => product.toItemJSON())
    );

    res.status(200).json({
      success: true,
      data: productsJSON,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération mes produits:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de vos annonces',
      error: error.message
    });
  }
};

// ===============================================
// ⭐ PROMOUVOIR UN PRODUIT (admin/premium)
// ===============================================
// @desc    Mettre en avant une annonce
// @route   PATCH /api/products/:id/promote
// @access  Private (propriétaire + admin)
exports.promoteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // 🔒 Vérifier que l'utilisateur est le propriétaire
    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }

    const { promoted, featured } = req.body;

    if (promoted !== undefined) product.promoted = promoted;
    if (featured !== undefined) product.featured = featured;

    await product.save();
    await product.populate('seller');

    const productJSON = await product.toItemJSON();

    res.status(200).json({
      success: true,
      message: 'Statut de promotion mis à jour',
      data: productJSON
    });

  } catch (error) {
    console.error('❌ Erreur promotion produit:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la promotion',
      error: error.message
    });
  }
};

// ===============================================
// 🔄 ACTIVER/DÉSACTIVER UNE ANNONCE
// ===============================================
// @desc    Basculer le statut d'une annonce (active/expired)
// @route   PATCH /api/products/:id/toggle-status
// @access  Private (propriétaire uniquement)
exports.toggleStatus = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // 🔒 Vérifier que l'utilisateur est le propriétaire
    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé : vous n\'êtes pas le propriétaire de cette annonce'
      });
    }

    // 🔄 Basculer entre active et expired
    if (product.status === 'active') {
      product.status = 'expired';
    } else if (product.status === 'expired' || product.status === 'pending') {
      product.status = 'active';
    } else {
      // Si status = 'sold', on ne peut pas le réactiver
      return res.status(400).json({
        success: false,
        message: 'Impossible de modifier le statut d\'une annonce vendue'
      });
    }

    await product.save();
    await product.populate('seller', 'name avatar phone email whatsapp businessType businessName rating totalSales location');

    // 📊 Mettre à jour les statistiques de la catégorie
    await updateCategoryStats(product.category);

    const productJSON = await product.toItemJSON();

    res.status(200).json({
      success: true,
      message: `Annonce ${product.status === 'active' ? 'activée' : 'désactivée'} avec succès`,
      data: productJSON
    });

  } catch (error) {
    console.error('❌ Erreur toggle status:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du changement de statut',
      error: error.message
    });
  }
};

// ===============================================
// 📊 STATISTIQUES DU VENDEUR
// ===============================================
// @desc    Obtenir les stats de mes annonces
// @route   GET /api/products/my/stats
// @access  Private
exports.getMyStats = async (req, res) => {
  try {
    const [
      totalActive,
      totalSold,
      totalViews,
      totalFavorites
    ] = await Promise.all([
      Product.countDocuments({ seller: req.user._id, status: 'active' }),
      Product.countDocuments({ seller: req.user._id, status: 'sold' }),
      Product.aggregate([
        { $match: { seller: req.user._id } },
        { $group: { _id: null, total: { $sum: '$views' } } }
      ]),
      Product.aggregate([
        { $match: { seller: req.user._id } },
        { $group: { _id: null, total: { $sum: '$favorites' } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalActive,
        totalSold,
        totalViews: totalViews[0]?.total || 0,
        totalFavorites: totalFavorites[0]?.total || 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques',
      error: error.message
    });
  }
};

// ===============================================
// 📍 OBTENIR LES LOCALISATIONS
// ===============================================
// @desc    Obtenir les localisations uniques où il y a des produits actifs
// @route   GET /api/products/locations
// @access  Public
exports.getLocations = async (req, res) => {
  try {
    // 📍 Récupérer les localisations des produits actifs
    const productLocations = await Product.distinct('location', { status: 'active' });
    
    // 👥 Récupérer les localisations des vendeurs qui ont des produits actifs
    const sellersWithProducts = await Product.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$seller' } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'sellerInfo'
        }
      },
      { $unwind: '$sellerInfo' },
      { $match: { 'sellerInfo.location': { $exists: true, $ne: '' } } },
      { $group: { _id: '$sellerInfo.location' } }
    ]);
    
    const sellerLocations = sellersWithProducts.map(item => item._id);
    
    // 🔗 Combiner et dédupliquer les localisations
    const allLocations = [...new Set([...productLocations, ...sellerLocations])];
    
    // 📊 Trier alphabétiquement et filtrer les valeurs vides
    const sortedLocations = allLocations
      .filter(loc => loc && loc.trim() !== '')
      .sort((a, b) => a.localeCompare(b, 'fr'));

    res.status(200).json({
      success: true,
      data: sortedLocations
    });

  } catch (error) {
    console.error('❌ Erreur récupération localisations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des localisations',
      error: error.message
    });
  }
};

// ===============================================
// 📊 STATISTIQUES GLOBALES DE LA PLATEFORME
// ===============================================
// @desc    Statistiques globales (annonces, membres, villes)
// @route   GET /api/products/platform/stats
// @access  Public
exports.getPlatformStats = async (req, res) => {
  try {
    const User = require('../models/User');

    // Compter les annonces actives
    const totalProducts = await Product.countDocuments({ status: 'active' });
    
    // Compter les utilisateurs actifs
    const totalUsers = await User.countDocuments({ isActive: true });
    
    // Compter les villes uniques (depuis products + users)
    const productLocations = await Product.distinct('location', { status: 'active' });
    const userLocations = await User.distinct('location', { isActive: true });
    
    // Extraire les villes (avant la virgule) et dédupliquer
    const extractCity = (location) => {
      if (!location) return null;
      const city = location.split(',')[0].trim();
      return city;
    };
    
    const allCities = [
      ...productLocations.map(extractCity),
      ...userLocations.map(extractCity)
    ].filter(city => city && city !== '');
    
    const uniqueCities = [...new Set(allCities)];
    const totalCities = uniqueCities.length;

    // Compter produits vs services
    const totalProductType = await Product.countDocuments({ status: 'active', type: 'product' });
    const totalServiceType = await Product.countDocuments({ status: 'active', type: 'service' });

    res.status(200).json({
      success: true,
      data: {
        totalProducts,
        totalUsers,
        totalCities,
        productsByType: {
          products: totalProductType,
          services: totalServiceType
        },
        topCities: uniqueCities.slice(0, 10) // Top 10 villes
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération stats plateforme:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques',
      error: error.message
    });
  }
};

// ===============================================
// 👥 VENDEURS ACTIFS
// ===============================================
// @desc    Liste des vendeurs avec annonces actives
// @route   GET /api/products/active-sellers
// @access  Public
exports.getActiveSellers = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Agréger les vendeurs avec leurs stats
    const activeSellers = await Product.aggregate([
      { $match: { status: 'active' } },
      {
        $group: {
          _id: '$seller',
          productCount: { $sum: 1 },
          lastActivity: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'sellerInfo'
        }
      },
      { $unwind: '$sellerInfo' },
      {
        $project: {
          _id: '$sellerInfo._id',
          name: '$sellerInfo.name',
          avatar: '$sellerInfo.avatar',
          location: '$sellerInfo.location',
          businessType: '$sellerInfo.businessType',
          businessName: '$sellerInfo.businessName',
          rating: '$sellerInfo.sellerStats.rating',
          productCount: 1,
          lastActivity: 1,
          // Considérer comme "en ligne" si activité dans les dernières 24h
          isOnline: {
            $gte: ['$lastActivity', new Date(Date.now() - 24 * 60 * 60 * 1000)]
          }
        }
      },
      { $sort: { isOnline: -1, productCount: -1, lastActivity: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.status(200).json({
      success: true,
      data: activeSellers
    });

  } catch (error) {
    console.error('❌ Erreur récupération vendeurs actifs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des vendeurs actifs',
      error: error.message
    });
  }
};
