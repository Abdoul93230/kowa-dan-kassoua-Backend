// ===============================================
// 🏠 ACCUEIL — tout l'écran d'accueil en UNE requête
// ===============================================
// Avant : 7 appels HTTP par ouverture de l'accueil (annonces récentes, tendances, services,
// catégories, vendeurs, stats, villes), chacun refaisant ses calculs pour chaque utilisateur.
// Ici : une réponse unique, au format carte (léger), mise en cache 60 s par ville/type.
// 10 000 ouvertures de l'accueil par minute = 1 seul calcul en base par combinaison.

const cache = require('../utils/cache');
const { findProducts } = require('../utils/productSerializer');
const {
  locationFilter,
  loadLocations,
  loadPlatformStats,
  loadActiveSellers,
} = require('./product.controller');
const { loadCategories } = require('./category.controller');

const HOME_TTL_MS = 60 * 1000;
const TYPES = ['product', 'service'];

const extractCity = (location) => String(location || '').split(',')[0].trim();

// @route   GET /api/home?location=Niamey&type=product
// @access  Public
exports.getHome = async (req, res) => {
  try {
    const location = String(req.query.location || '').trim().slice(0, 60);
    const type = TYPES.includes(req.query.type) ? req.query.type : '';
    const key = `home:${location.toLowerCase() || 'all'}:${type || 'all'}`;

    const data = await cache.wrap(key, HOME_TTL_MS, async () => {
      const base = { status: 'active', ...(location ? { location: locationFilter(location) } : {}) };

      const [latest, trending, services, categories, sellers, stats, locations] = await Promise.all([
        findProducts({ ...base, ...(type ? { type } : {}) }, { sort: '-createdAt', limit: 20, view: 'card' }),
        findProducts(base, { sort: '-views', limit: 10, view: 'card' }),
        findProducts({ ...base, type: 'service' }, { sort: '-createdAt', limit: 10, view: 'card' }),
        loadCategories(),
        loadActiveSellers(12),
        loadPlatformStats(),
        loadLocations(),
      ]);

      return {
        latest,
        trending,
        services,
        categories,
        sellers,
        stats,
        cities: [...new Set(locations.map(extractCity).filter(Boolean))].slice(0, 15),
        generatedAt: new Date().toISOString(),
      };
    });

    // Données publiques : les proxys/CDN et l'app peuvent les réutiliser quelques secondes
    res.set('Cache-Control', 'public, max-age=30');
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ Erreur accueil:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du chargement de l'accueil",
      error: error.message,
    });
  }
};
