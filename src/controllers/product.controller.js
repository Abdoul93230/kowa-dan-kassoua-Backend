const Product = require('../models/Product');
const Category = require('../models/Category');
const { uploadMultipleImages, deleteImage } = require('../utils/uploadImage');
const { findProducts, serializeProducts, listPopulate } = require('../utils/productSerializer');
const cache = require('../utils/cache');

// Échapper le texte saisi avant de l'utiliser dans une RegExp (évite les erreurs sur 'c++', '(' ...)
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// RegExp de recherche insensible à la casse ET aux accents ("telephone" trouve "Téléphone")
const ACCENT_CLASSES = { a: '[aàâä]', e: '[eéèêë]', i: '[iîï]', o: '[oôö]', u: '[uùûü]', c: '[cç]', y: '[yÿ]' };
const searchRegex = (value = '') => {
  const plain = String(value).trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pattern = escapeRegExp(plain).replace(/[aeiouyc]/gi, (ch) => ACCENT_CLASSES[ch.toLowerCase()] || ch);
  return new RegExp(pattern, 'i');
};

// Filtre ville : « Niamey » trouve « Niamey, Niger » (préfixe → utilise l'index location)
const locationFilter = (value = '') => new RegExp(`^${searchRegex(value).source}`, 'i');
exports.locationFilter = locationFilter;

// Les données publiques (accueil, stats, villes) sont mises en cache : on les invalide
// dès qu'une annonce est créée, modifiée ou retirée pour que l'accueil reste à jour.
const invalidatePublicCaches = () => {
  cache.invalidate('home:');
  cache.invalidate('public:');
};

// ===============================================
// 🔎 ATLAS SEARCH (facultatif)
// ===============================================
// Activé si ATLAS_SEARCH_INDEX est défini dans .env (nom de l'index créé dans MongoDB Atlas,
// définition fournie dans backend/atlas-search-index.json). Sinon : recherche classique par regex.
const ATLAS_SEARCH_INDEX = process.env.ATLAS_SEARCH_INDEX || '';
// Après un échec (index absent, coupure…), recherche classique pendant 5 min puis nouvel essai
const ATLAS_RETRY_MS = 5 * 60 * 1000;
let atlasSearchRetryAt = 0;

const ATLAS_SORTS = {
  createdAt: { createdAt: 1 },
  '-views': { views: -1 },
  '-favorites': { favorites: -1 },
  // '-createdAt' (par défaut) : ordre de pertinence calculé par Atlas
};

async function atlasSearchPage({ text, filter, sort, skip, limit, view, withTotal }) {
  const pipeline = [
    {
      $search: {
        index: ATLAS_SEARCH_INDEX,
        compound: {
          should: [
            // Début de mot dans le titre, avec une faute tolérée — le plus important
            { autocomplete: { query: text, path: 'title', fuzzy: { maxEdits: 1 }, score: { boost: { value: 3 } } } },
            // Mots complets dans le titre ou la description, fautes tolérées
            { text: { query: text, path: ['title', 'description'], fuzzy: { maxEdits: 1 } } },
          ],
          minimumShouldMatch: 1,
        },
      },
    },
    { $match: filter }, // mêmes filtres que la recherche classique (statut, catégorie, ville, prix…)
  ];
  if (ATLAS_SORTS[sort]) pipeline.push({ $sort: ATLAS_SORTS[sort] });

  const [docs, counted] = await Promise.all([
    Product.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
    withTotal ? Product.aggregate([...pipeline, { $count: 'total' }]) : Promise.resolve(null),
  ]);

  const hydrated = docs.map((doc) => Product.hydrate(doc));
  await Product.populate(hydrated, listPopulate(view));
  return {
    items: await serializeProducts(hydrated, view),
    total: counted ? counted[0]?.total || 0 : null,
  };
}

// ===============================================
// 🔄 FONCTIONS UTILITAIRES POUR LES STATS
// ===============================================

/**
 * Mettre à jour les statistiques d'une catégorie
 * @param {ObjectId} categoryId - ID de la catégorie
 */
const updateCategoryStats = async (categoryId) => {
  // Toute modification d'annonce passe par ici : l'accueil, les stats et les catégories en cache sont périmés
  invalidatePublicCaches();
  cache.invalidate('categories:');

  try {
    if (!categoryId) return;

    // Compter les produits et services actifs (en parallèle) puis une seule écriture
    const [productsCount, servicesCount] = await Promise.all([
      Product.countDocuments({ category: categoryId, type: 'product', status: 'active' }),
      Product.countDocuments({ category: categoryId, type: 'service', status: 'active' }),
    ]);

    await Category.updateOne({ _id: categoryId }, { $set: { productsCount, servicesCount } });
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
    if (!title || !category || !price) {
      return res.status(400).json({
        success: false,
        message: 'Champs obligatoires manquants : title, category, price'
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
    const mongoose = require('mongoose');
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
      sort = '-createdAt', // Par défaut : plus récents. Aussi : price, -price, -views, -favorites
      view = 'full',       // 'card' : format allégé pour les listes (mobile)
      withTotal = '1'      // '0' : pas de comptage (carrousels, aperçus)
    } = req.query;
    const listView = view === 'card' ? 'card' : 'full';

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;
    const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && /^[0-9a-fA-F]{24}$/.test(String(v));

    // 🧱 Filtre unique, partagé par toutes les combinaisons de critères
    const filter = { status };
    const and = [];

    // 🏷️ Catégorie : slug ou ObjectId
    if (categorySlug) {
      filter.categorySlug = categorySlug;
    } else if (category) {
      if (isObjectId(category)) filter.category = new mongoose.Types.ObjectId(category);
      else filter.categorySlug = category;
    }
    // Sous-catégorie : selon le client, enregistrée par slug ou par nom
    if (subcategory) and.push({ $or: [{ subcategory }, { subcategorySlug: String(subcategory).toLowerCase() }] });
    if (type) filter.type = type;
    if (condition) filter.condition = condition;
    if (seller && isObjectId(seller)) filter.seller = new mongoose.Types.ObjectId(seller);

    // 📍 Localisation de l'annonce (« Ville, Pays ») — toujours renseignée à la création,
    // donc inutile de charger tous les vendeurs de la ville. Ancrée au début : parcours d'index.
    if (location) filter.location = locationFilter(location);

    // 🔎 Recherche texte classique (titre + description) — tous les mots doivent correspondre.
    // Gardée à part : avec Atlas Search, ce sont les autres filtres qui s'appliquent après $search.
    const searchText = String(search || '').trim();
    const searchAnd = searchText
      ? searchText.split(/\s+/).map((word) => {
        const wordRegex = searchRegex(word);
        return { $or: [{ title: wordRegex }, { description: wordRegex }] };
      })
      : [];

    // 💰 Prix (stocké en texte) — les prix non numériques sont ignorés au lieu de faire échouer la requête
    const priceNum = { $convert: { input: '$price', to: 'double', onError: null, onNull: null } };
    const priceConditions = [];
    if (minPrice !== undefined && minPrice !== '' && !Number.isNaN(parseFloat(minPrice))) {
      priceConditions.push({ $gte: [priceNum, parseFloat(minPrice)] });
    }
    if (maxPrice !== undefined && maxPrice !== '' && !Number.isNaN(parseFloat(maxPrice))) {
      priceConditions.push({ $lte: [priceNum, parseFloat(maxPrice)] });
      priceConditions.push({ $ne: [priceNum, null] });
    }
    if (priceConditions.length) {
      filter.$expr = priceConditions.length === 1 ? priceConditions[0] : { $and: priceConditions };
    }

    // Filtres hors recherche texte (utilisés tels quels après Atlas Search)
    const filtersOnly = and.length ? { ...filter, $and: [...and] } : { ...filter };
    if (and.length || searchAnd.length) filter.$and = [...and, ...searchAnd];

    // 📊 Exécution — le tri par prix passe par une agrégation (tri numérique, pas alphabétique)
    const isPriceSort = sort === 'price' || sort === '-price';

    const loadPage = async () => {
      if (isPriceSort) {
        const docs = await Product.aggregate([
          { $match: filter },
          { $addFields: { _priceNum: priceNum } },
          // Les annonces "prix à discuter" passent toujours en dernier
          { $addFields: { _hasPrice: { $cond: [{ $gt: ['$_priceNum', 0] }, 1, 0] } } },
          { $sort: { _hasPrice: -1, _priceNum: sort === 'price' ? 1 : -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limitNum },
          { $project: { _priceNum: 0, _hasPrice: 0 } }
        ]);
        const hydrated = docs.map((doc) => Product.hydrate(doc));
        await Product.populate(hydrated, listPopulate(listView));
        return serializeProducts(hydrated, listView);
      }
      const allowedSorts = ['-createdAt', 'createdAt', '-views', '-favorites'];
      return findProducts(filter, {
        sort: allowedSorts.includes(sort) ? sort : '-createdAt',
        skip,
        limit: limitNum,
        view: listView,
      });
    };

    // Compteurs par type (Tout / Produits / Services) dans la même réponse : ?facets=type
    const loadTypeFacets = async () => {
      if (req.query.facets !== 'type') return null;
      const { type: _ignored, ...withoutType } = filter;
      const rows = await Product.aggregate([
        { $match: withoutType },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]);
      const countOf = (t) => rows.find((r) => r._id === t)?.count || 0;
      return { all: rows.reduce((sum, r) => sum + r.count, 0), product: countOf('product'), service: countOf('service') };
    };

    // 🔎 Atlas Search (si ATLAS_SEARCH_INDEX est défini) : pertinence, fautes de frappe tolérées,
    // début de mot (« tel » → « téléphone »). Repli automatique sur la recherche classique en cas d'échec.
    if (searchText && ATLAS_SEARCH_INDEX && Date.now() >= atlasSearchRetryAt && !isPriceSort) {
      try {
        const [result, atlasFacets] = await Promise.all([
          atlasSearchPage({
            text: searchText,
            filter: filtersOnly,
            sort,
            skip,
            limit: limitNum,
            view: listView,
            withTotal: withTotal !== '0',
          }),
          loadTypeFacets(),
        ]);
        const atlasTotal = result.total;
        return res.status(200).json({
          success: true,
          data: result.items,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: atlasTotal ?? undefined,
            pages: atlasTotal == null ? undefined : Math.ceil(atlasTotal / limitNum),
            hasMore: atlasTotal == null ? result.items.length === limitNum : skip + result.items.length < atlasTotal
          },
          ...(atlasFacets ? { facets: atlasFacets } : {})
        });
      } catch (error) {
        atlasSearchRetryAt = Date.now() + ATLAS_RETRY_MS;
        console.warn('⚠️ Atlas Search indisponible, recherche classique utilisée :', error.message);
      }
    }

    // Page, comptage et compteurs en parallèle (comptage et compteurs facultatifs)
    const [productsJSON, total, facets] = await Promise.all([
      loadPage(),
      withTotal === '0' ? Promise.resolve(null) : Product.countDocuments(filter),
      loadTypeFacets(),
    ]);

    // 🔀 Tri par pertinence quand une recherche est active (sur la page courante)
    if (search && sort === '-createdAt') {
      const searchLower = String(search).toLowerCase();
      const score = (item) => {
        const title = (item.title || '').toLowerCase();
        if (title === searchLower) return 2;
        return title.includes(searchLower) ? 1 : 0;
      };
      productsJSON.sort((a, b) => score(b) - score(a));
    }

    res.status(200).json({
      success: true,
      data: productsJSON,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total ?? undefined,
        pages: total == null ? undefined : Math.ceil(total / limitNum),
        hasMore: total == null ? productsJSON.length === limitNum : skip + productsJSON.length < total
      },
      ...(facets ? { facets } : {})
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
      .populate('seller', '_id name avatar phone email whatsapp businessType businessName description location rating totalSales memberSince sellerStats contactInfo verified createdAt')
      .populate('category', 'name');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    // � Vérifier si le produit est actif
    // Si l'utilisateur n'est pas le vendeur et que le produit n'est pas actif, refuser l'accès
    const isOwner = req.user && product.seller && product.seller._id.toString() === req.user.id;

    if (!isOwner && product.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Cette annonce n\'est plus disponible'
      });
    }

    // 📈 Vues : incrément atomique en arrière-plan (avant : réécriture complète du document,
    // attendue avant de répondre, et deux visites simultanées pouvaient s'écraser)
    if (product.status === 'active' || isOwner) {
      Product.updateOne({ _id: product._id }, { $inc: { views: 1 } }, { timestamps: false })
        .catch((err) => console.error('⚠️ Erreur incrément vues:', err.message));
      product.views = (product.views || 0) + 1;
    }

    // 🔄 Format Item (vendeur et catégorie déjà chargés ; stats vendeur en une agrégation)
    const [productJSON] = await serializeProducts([product], 'full');
    if (!productJSON) {
      return res.status(404).json({ success: false, message: 'Produit introuvable' });
    }

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
    
    console.log({
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
      newImages,
      deleteImages 
    })

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
    invalidatePublicCaches();
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
    const { status, type, search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    const filter = { seller: req.user._id };
    if (status) filter.status = status;
    if (type) filter.type = type;
    // Recherche dans mes annonces (titre + description), insensible aux accents
    if (search && String(search).trim()) {
      filter.$and = String(search).trim().split(/\s+/).map((word) => {
        const wordRegex = searchRegex(word);
        return { $or: [{ title: wordRegex }, { description: wordRegex }] };
      });
    }

    const skip = (pageNum - 1) * limitNum;

    const [productsJSON, total] = await Promise.all([
      findProducts(filter, { sort: '-createdAt', skip, limit: limitNum, view: 'full' }),
      Product.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: productsJSON,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
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
    invalidatePublicCaches();
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
// ✅ MARQUER COMME VENDU
// ===============================================
// @desc    Passer une annonce au statut « vendu » (n'apparaît plus dans les recherches)
// @route   PATCH /api/products/:id/mark-sold
// @access  Private (propriétaire uniquement)
exports.markSold = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Produit introuvable' });
    }

    if (product.seller.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé : vous n\'êtes pas le propriétaire de cette annonce'
      });
    }

    if (product.status === 'sold') {
      return res.status(400).json({ success: false, message: 'Cette annonce est déjà marquée comme vendue' });
    }

    product.status = 'sold';
    await product.save();
    await updateCategoryStats(product.category);

    res.status(200).json({
      success: true,
      message: 'Annonce marquée comme vendue',
      data: await product.toItemJSON()
    });
  } catch (error) {
    console.error('❌ Erreur mark-sold:', error);
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
    // Un seul passage sur les annonces du vendeur (avant : 6 requêtes séparées)
    const rows = await Product.aggregate([
      { $match: { seller: req.user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          views: { $sum: { $ifNull: ['$views', 0] } },
          favorites: { $sum: { $ifNull: ['$favorites', 0] } }
        }
      }
    ]);

    const countOf = (...statuses) => rows
      .filter((row) => statuses.includes(row._id))
      .reduce((sum, row) => sum + row.count, 0);

    res.status(200).json({
      success: true,
      data: {
        totalActive: countOf('active'),
        totalSold: countOf('sold'),
        totalExpired: countOf('expired', 'pending'),
        totalAll: rows.reduce((sum, row) => sum + row.count, 0),
        totalViews: rows.reduce((sum, row) => sum + row.views, 0),
        totalFavorites: rows.reduce((sum, row) => sum + row.favorites, 0)
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
// 📍📊👥 DONNÉES PUBLIQUES MISES EN CACHE
// ===============================================
// Ces calculs parcourent de grandes parties de la base : ils ne sont plus refaits à chaque
// visite mais au plus une fois par période (et immédiatement après une modification d'annonce).
const PUBLIC_TTL_MS = 5 * 60 * 1000;

const extractCity = (location) => (location ? String(location).split(',')[0].trim() : '');

// Localisations des annonces actives (« Ville, Pays »), triées
const loadLocations = () => cache.wrap('public:locations', PUBLIC_TTL_MS, async () => {
  const locations = await Product.distinct('location', { status: 'active' });
  return locations
    .filter((loc) => loc && String(loc).trim() !== '')
    .sort((a, b) => a.localeCompare(b, 'fr'));
});

// Statistiques globales de la plateforme
const loadPlatformStats = () => cache.wrap('public:stats', PUBLIC_TTL_MS, async () => {
  const User = require('../models/User');
  const [byType, totalUsers, locations] = await Promise.all([
    Product.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ isActive: true }),
    loadLocations(),
  ]);

  const countOf = (type) => byType.find((row) => row._id === type)?.count || 0;
  const uniqueCities = [...new Set(locations.map(extractCity).filter(Boolean))];

  return {
    totalProducts: byType.reduce((sum, row) => sum + row.count, 0),
    totalUsers,
    totalCities: uniqueCities.length,
    productsByType: { products: countOf('product'), services: countOf('service') },
    topCities: uniqueCities.slice(0, 10),
  };
});

// Vendeurs actifs (ceux qui ont des annonces en ligne, les plus récents d'abord)
const loadActiveSellers = (limit = 12) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 30);
  return cache.wrap(`public:sellers:${safeLimit}`, PUBLIC_TTL_MS, () => Product.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$seller', productCount: { $sum: 1 }, lastActivity: { $max: '$createdAt' } } },
    { $sort: { lastActivity: -1 } },
    { $limit: safeLimit * 3 }, // on ne joint les profils que des candidats, pas de tous les vendeurs
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'sellerInfo' } },
    { $unwind: '$sellerInfo' },
    {
      $project: {
        _id: '$sellerInfo._id',
        name: '$sellerInfo.name',
        // Seules les URL d'images sont renvoyées (les anciennes photos en base64 pèsent des centaines de Ko)
        avatar: { $cond: [{ $regexMatch: { input: { $ifNull: ['$sellerInfo.avatar', ''] }, regex: /^https?:\/\//i } }, '$sellerInfo.avatar', null] },
        location: '$sellerInfo.location',
        businessType: '$sellerInfo.businessType',
        businessName: '$sellerInfo.businessName',
        rating: '$sellerInfo.sellerStats.rating',
        productCount: 1,
        lastActivity: 1,
        // « En ligne » : a publié dans les dernières 24 h
        isOnline: { $gte: ['$lastActivity', new Date(Date.now() - 24 * 60 * 60 * 1000)] },
      },
    },
    { $sort: { isOnline: -1, productCount: -1, lastActivity: -1 } },
    { $limit: safeLimit },
  ]));
};

exports.loadLocations = loadLocations;
exports.loadPlatformStats = loadPlatformStats;
exports.loadActiveSellers = loadActiveSellers;

const publicHandler = (label, loader) => async (req, res) => {
  try {
    const data = await loader(req);
    res.set('Cache-Control', 'public, max-age=60');
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`❌ Erreur ${label}:`, error);
    res.status(500).json({
      success: false,
      message: `Erreur lors de la récupération des ${label}`,
      error: error.message,
    });
  }
};

// @route   GET /api/products/locations
exports.getLocations = publicHandler('localisations', () => loadLocations());

// @route   GET /api/products/platform/stats
exports.getPlatformStats = publicHandler('statistiques', () => loadPlatformStats());

// @route   GET /api/products/active-sellers
exports.getActiveSellers = publicHandler('vendeurs actifs', (req) => loadActiveSellers(req.query.limit));

// ===============================================
// 🔍 SUGGESTIONS DE RECHERCHE
// ===============================================
// @desc    Suggestions de recherche (catégories + produits)
// @route   GET /api/products/search/suggestions?q=xxx
// @access  Public
exports.getSearchSuggestions = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(200).json({
        success: true,
        data: { recent: [], popular: [], categories: [], products: [] }
      });
    }

    const queryRegex = searchRegex(q);

    // Popular searches (hardcoded for now, can be replaced with analytics later)
    const popularSearches = [
      'Téléphones', 'Voitures', 'Immobilier', 'Vêtements', 'Électronique',
      'Meubles', 'Services', 'Motos', 'Ordinateurs', 'Accessoires'
    ];
    const popular = popularSearches.filter(s => queryRegex.test(s)).slice(0, 5);

    // Categories matching the query
    const categories = await Category.find(
      { name: queryRegex },
      { _id: 1, name: 1, slug: 1, icon: 1 }
    ).limit(5).lean();

    // Products matching the query (lightweight)
    const products = await Product.find(
      { title: queryRegex, status: 'active' },
      { _id: 1, title: 1, price: 1, mainImage: 1, type: 1, location: 1 }
    ).sort('-views').limit(5).lean();

    const formattedProducts = products.map(p => ({
      id: p._id,
      title: p.title,
      price: p.price,
      mainImage: p.mainImage,
      type: p.type,
      location: p.location
    }));

    res.status(200).json({
      success: true,
      data: {
        recent: [], // Recent searches are handled client-side via AsyncStorage
        popular,
        categories,
        products: formattedProducts
      }
    });

  } catch (error) {
    console.error('Error getting search suggestions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des suggestions',
      error: error.message
    });
  }
};