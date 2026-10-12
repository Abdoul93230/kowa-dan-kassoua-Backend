// Sérialisation des listes d'annonces EN LOT.
// Avant : toItemJSON() faisait 3 requêtes par annonce (vendeur, catégorie, annonces du vendeur)
// → 60 requêtes pour une page de 20. Ici : vendeurs et catégories sont chargés en une requête
// chacun ($in), et les statistiques vendeurs en une seule agrégation pour toute la page.
//
// Deux formats :
//  - 'full' : identique à toItemJSON() (compatibilité web)
//  - 'card' : uniquement ce qu'affiche une carte d'annonce (≈ 5× plus léger sur le réseau)

const Product = require('../models/Product');
const { publicAvatar } = require('./avatar');

const CARD_PROJECTION = {
  title: 1, price: 1, location: 1, mainImage: 1, images: { $slice: 1 },
  category: 1, categorySlug: 1, subcategory: 1, type: 1, condition: 1,
  promoted: 1, featured: 1, rating: 1, totalReviews: 1, views: 1, favorites: 1,
  status: 1, seller: 1, createdAt: 1,
};
const CARD_SELLER_FIELDS = 'name businessName avatar verified location';

// Options populate à appliquer à la requête (chargement groupé par Mongoose)
const listPopulate = (view) => [
  { path: 'seller', select: view === 'card' ? CARD_SELLER_FIELDS : '-password' },
  { path: 'category', select: 'name' },
];

// Statistiques de tous les vendeurs de la page en UNE agrégation (index seller+status)
async function sellerListingStats(sellerIds) {
  if (!sellerIds.length) return new Map();
  const rows = await Product.aggregate([
    { $match: { seller: { $in: sellerIds }, status: 'active' } },
    {
      $group: {
        _id: '$seller',
        totalListings: { $sum: 1 },
        totalReviews: { $sum: { $ifNull: ['$totalReviews', 0] } },
        weighted: { $sum: { $multiply: [{ $ifNull: ['$rating', 0] }, { $ifNull: ['$totalReviews', 0] }] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), {
    totalListings: r.totalListings,
    totalReviews: r.totalReviews,
    rating: r.totalReviews > 0 ? r.weighted / r.totalReviews : 0,
  }]));
}

const categoryOf = (p) => {
  const cat = p.category;
  if (cat && typeof cat === 'object' && cat.name) return { name: cat.name, id: String(cat._id) };
  return { name: p.categorySlug || 'Catégorie non disponible', id: cat ? String(cat._id || cat) : '' };
};

function toCard(p) {
  const seller = p.seller;
  const { name, id } = categoryOf(p);
  const image = p.mainImage || p.images?.[0] || null;
  return {
    id: String(p._id),
    title: p.title,
    price: p.price,
    location: p.location,
    mainImage: image,
    images: image ? [image] : [],
    category: name,
    categorySlug: p.categorySlug,
    categoryId: id,
    subcategory: p.subcategory,
    type: p.type,
    condition: p.condition,
    promoted: p.promoted,
    featured: p.featured,
    rating: p.rating,
    totalReviews: p.totalReviews,
    views: p.views,
    favorites: p.favorites,
    status: p.status,
    createdAt: p.createdAt,
    postedTime: p.postedTime,
    sellerId: String(seller._id),
    seller: {
      id: String(seller._id),
      name: seller.name,
      businessName: seller.businessName,
      avatar: publicAvatar(seller.avatar),
      verified: seller.verified,
    },
  };
}

function toFull(p, stats) {
  const seller = p.seller;
  const { name, id } = categoryOf(p);
  const st = stats.get(String(seller._id)) || { totalListings: 0, totalReviews: 0, rating: 0 };
  const sellerJson = seller.toSellerJSON(st.totalListings);
  sellerJson.rating = st.rating;
  sellerJson.totalReviews = st.totalReviews;

  return {
    id: String(p._id),
    title: p.title,
    price: p.price,
    location: p.location,
    images: p.images,
    mainImage: p.mainImage,
    category: name,
    categorySlug: p.categorySlug,
    categoryId: id,
    subcategory: p.subcategory,
    type: p.type,
    rating: p.rating,
    totalReviews: p.totalReviews,
    seller: sellerJson,
    sellerId: String(seller._id),
    promoted: p.promoted,
    featured: p.featured,
    postedTime: p.postedTime,
    postedDate: p.postedDate,
    createdAt: p.createdAt,
    description: p.description,
    condition: p.condition,
    quantity: p.quantity,
    views: p.views,
    favorites: p.favorites,
    delivery: p.delivery,
    availability: p.availability,
    serviceArea: p.serviceArea,
    specifications: Object.fromEntries(p.specifications || new Map()),
    status: p.status,
  };
}

/**
 * Sérialise des documents Product déjà « populés » via listPopulate(view).
 * Les annonces dont le vendeur a été supprimé sont ignorées (au lieu de faire échouer la liste).
 */
async function serializeProducts(products, view = 'full') {
  const valid = products.filter((p) => p.seller && p.seller._id);
  if (view === 'card') return valid.map(toCard);

  const sellerIds = [...new Map(valid.map((p) => [String(p.seller._id), p.seller._id])).values()];
  const stats = await sellerListingStats(sellerIds);
  return valid.map((p) => toFull(p, stats));
}

/**
 * Charge une page d'annonces (filtre Mongo) et la sérialise.
 */
async function findProducts(filter, { sort = '-createdAt', skip = 0, limit = 20, view = 'full' } = {}) {
  const query = Product.find(filter).sort(sort).skip(skip).limit(limit).populate(listPopulate(view));
  if (view === 'card') query.select(CARD_PROJECTION);
  return serializeProducts(await query, view);
}

module.exports = { findProducts, serializeProducts, listPopulate, CARD_PROJECTION };
