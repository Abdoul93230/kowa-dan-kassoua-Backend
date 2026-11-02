// Crée le compte de test pour la revue Apple / Google, avec des données pour voir toute l'app :
// annonces, conversations (achats et ventes, non lus, affaire à confirmer, avis à laisser),
// favoris et avis. Tout est marqué isDemoAccount et les annonces sont titrées « Démo - ».
//
// Usage :
//   node create-review-account.js --phone "+227 90123456" --email test@exemple.com --password "MotDePasse"
//     → sans --yes, affiche seulement la base visée et ce qui sera fait
//   node create-review-account.js --phone ... --email ... --password ... --yes
//     → crée le compte. Relancer remet tout à zéro (utile si le testeur a supprimé le compte).
//   node create-review-account.js --remove --yes
//     → supprime tous les comptes de démo et leurs données, à faire après la revue
//
// Options : --name "Nom affiché" (défaut : Compte Test TakTak)
// Refuse de toucher à un vrai compte : le téléphone et l'email doivent être libres ou déjà en démo.

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Product = require('./src/models/Product');
const Category = require('./src/models/Category');
const Conversation = require('./src/models/Conversation');
const Message = require('./src/models/Message');
const Favorite = require('./src/models/Favorite');
const Review = require('./src/models/Review');

const DIAL_CODES = ['+227', '+221', '+225', '+226', '+223', '+228', '+229']; // Pays proposés à la connexion
const DEMO_NOTE = "\n\nAnnonce de démonstration : cet article n'est pas réellement en vente.";
const MINUTE = 60000;
const DAY = 1440; // en minutes

const photo = (id) => `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`;
const ago = (minutes) => new Date(Date.now() - minutes * MINUTE);
const newId = () => new mongoose.Types.ObjectId();

// ─── Arguments ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`Argument inattendu : ${argv[i]}`);
    const key = argv[i].slice(2);
    if (key === 'yes' || key === 'remove') args[key] = true;
    else {
      if (argv[i + 1] === undefined) throw new Error(`Valeur manquante pour --${key}`);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

// « +227 90 12 34 56 » → « +227 90123456 », le format envoyé par l'app à la connexion
function normalizePhone(value) {
  const compact = String(value || '').replace(/[\s.-]/g, '');
  const dial = DIAL_CODES.find((code) => compact.startsWith(code));
  const digits = dial ? compact.slice(dial.length) : '';
  if (!/^\d{8,10}$/.test(digits)) {
    throw new Error(`Téléphone invalide. Exemple : "+227 90123456" (indicatifs : ${DIAL_CODES.join(', ')})`);
  }
  return `${dial} ${digits}`;
}

function validateCredentials(args) {
  const phone = normalizePhone(args.phone);
  const email = String(args.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email invalide (--email)');
  if (String(args.password || '').length < 6) throw new Error('Mot de passe : 6 caractères minimum (--password)');
  return { phone, email, password: args.password, name: args.name || 'Compte Test TakTak' };
}

// ─── Données de démonstration ───────────────────────────────────────────────
const PARTNERS = {
  aicha: { name: 'Aïcha (compte démo)', email: 'demo.aicha@taktak-demo.invalid', businessType: 'professional', businessName: 'Aïcha Couture (démo)', location: 'Niamey', description: 'Boutique de démonstration TakTak.', verified: true },
  moussa: { name: 'Moussa (compte démo)', email: 'demo.moussa@taktak-demo.invalid', businessType: 'individual', location: 'Maradi', description: 'Vendeur de démonstration TakTak.' },
  fatima: { name: 'Fatima (compte démo)', email: 'demo.fatima@taktak-demo.invalid', businessType: 'individual', location: 'Zinder', description: 'Acheteuse de démonstration TakTak.' },
};

// seller : 'me' (le compte de test) ou un partenaire
const LISTINGS = {
  // Annonces du compte de test
  phone: { seller: 'me', title: 'Samsung Galaxy A15 128 Go', type: 'product', category: 'telephonie-materiel-electronique', subcategory: 'electronique-info', price: '95000', images: ['1511707171634-5f897ff02aa9'], condition: 'used', age: 2 * DAY, views: 48, delivery: { available: true, cost: '1000', areas: ['Niamey'], estimatedTime: '24h' }, specifications: { Stockage: '128 Go', Couleur: 'Noir' }, description: 'Téléphone en très bon état, vendu avec son chargeur et sa coque.' },
  headphones: { seller: 'me', title: 'Casque audio sans fil', type: 'product', category: 'telephonie-materiel-electronique', subcategory: 'electronique-info', price: '18000', images: ['1484704849700-f032a568e944'], condition: 'new', age: 6 * DAY, views: 27, description: 'Casque Bluetooth neuf, 30 heures d’autonomie.' },
  repair: { seller: 'me', title: 'Réparation de téléphones à domicile', type: 'service', category: 'telephonie-materiel-electronique', subcategory: 'reparation', price: '5000', images: ['1517336714731-489689fd1ca8'], age: 9 * DAY, views: 61, availability: { days: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'], openingTime: '08:00', closingTime: '18:00' }, serviceArea: ['Niamey'], description: 'Écran, batterie, connecteur : réparation rapide chez vous.' },
  watch: { seller: 'me', title: 'Montre connectée', type: 'product', category: 'telephonie-materiel-electronique', subcategory: 'electronique-info', price: '22000', images: ['1523275335684-37898b6baf30'], condition: 'used', status: 'sold', age: 20 * DAY, views: 35, description: 'Montre connectée, vendue.' },
  // Annonces des partenaires
  fabric: { seller: 'aicha', title: 'Pagne wax 6 yards', type: 'product', category: 'habillement-beaute', subcategory: 'tissus-pagnes', price: '15000', images: ['1605559424843-9e4c228bf1c2'], condition: 'new', age: 4 * DAY, views: 52, description: 'Pagne wax de qualité, plusieurs motifs disponibles.' },
  sneakers: { seller: 'aicha', title: 'Baskets rouges pointure 42', type: 'product', category: 'habillement-beaute', subcategory: 'friperie', price: '20000', images: ['1542291026-7eec264c27ff'], condition: 'used', age: 8 * DAY, views: 39, description: 'Baskets très peu portées.' },
  cosmetics: { seller: 'aicha', title: 'Coffret soins naturels', type: 'product', category: 'habillement-beaute', subcategory: 'cosmetiques', price: '12500', images: ['1556228453-efd6c1ff04f6'], condition: 'new', age: 12 * DAY, views: 44, description: 'Crème et huile naturelles.' },
  moto: { seller: 'moussa', title: 'Moto 125 cm3 bon état', type: 'product', category: 'transport-mecanique-energie', subcategory: 'motos', price: '450000', images: ['1558981806-ec527fa84c39'], condition: 'used', age: 5 * DAY, views: 88, specifications: { Cylindrée: '125 cm3', Année: '2022' }, description: 'Moto bien entretenue, papiers en règle.' },
  laptop: { seller: 'moussa', title: 'Ordinateur portable 14 pouces', type: 'product', category: 'telephonie-materiel-electronique', subcategory: 'electronique-info', price: '210000', images: ['1496181133206-80ce9b88a853'], condition: 'refurbished', age: 11 * DAY, views: 73, description: 'Reconditionné, 8 Go de mémoire, garantie 3 mois.' },
  sofa: { seller: 'fatima', title: 'Canapé 3 places', type: 'product', category: 'maison-bricolage', subcategory: 'ameublement', price: '130000', images: ['1586023492125-27b2c045efd7'], condition: 'used', age: 15 * DAY, views: 31, description: 'Canapé confortable à retirer sur place.' },
};

// Parcours couverts : achat avec non lus, affaire à confirmer, avis à laisser, vente avec non lus, vente conclue.
// unread : message pas encore lu par son destinataire
const CONVERSATIONS = [
  {
    buyer: 'me', seller: 'aicha', item: 'fabric',
    messages: [
      { from: 'me', text: 'Bonjour, ce pagne est-il toujours disponible ?', ago: 180 },
      { from: 'aicha', text: 'Bonjour ! Oui, il me reste trois motifs.', ago: 170 },
      { from: 'me', text: 'Parfait. Pouvez-vous le livrer à Niamey ?', ago: 90 },
      { from: 'aicha', text: 'Oui, la livraison est possible demain matin.', ago: 12, unread: true },
      { from: 'aicha', text: 'Quel quartier vous arrange ?', ago: 11, unread: true },
    ],
  },
  {
    buyer: 'me', seller: 'moussa', item: 'moto',
    deal: { status: 'pending_conclusion', requestedBy: 'moussa', requestedAgo: 30 },
    messages: [
      { from: 'me', text: 'Bonjour, je peux voir la moto cette semaine ?', ago: 2 * DAY },
      { from: 'moussa', text: 'Bien sûr, je suis disponible jeudi.', ago: 2 * DAY - 20 },
      { from: 'me', text: 'Merci, à jeudi au marché.', ago: DAY },
      { from: 'moussa', text: "Merci pour l'achat ! Pouvez-vous confirmer l'affaire dans l'application ?", ago: 30, unread: true },
    ],
  },
  {
    buyer: 'me', seller: 'aicha', item: 'cosmetics',
    deal: { status: 'concluded', requestedBy: 'aicha', requestedAgo: 3 * DAY, resolvedBy: 'me', resolvedAgo: 3 * DAY - 60 },
    closed: { ago: 3 * DAY - 90 },
    messages: [
      { from: 'me', text: 'Bonjour, le coffret est-il encore en vente ?', ago: 5 * DAY },
      { from: 'aicha', text: 'Oui, je peux vous le remettre demain.', ago: 5 * DAY - 15 },
      { from: 'me', text: 'Très bien, merci beaucoup !', ago: 3 * DAY - 120 },
    ],
  },
  {
    buyer: 'fatima', seller: 'me', item: 'phone',
    messages: [
      { from: 'fatima', text: 'Bonjour, le Samsung est-il encore disponible ?', ago: 60 },
      { from: 'me', text: 'Bonjour, oui, il est disponible.', ago: 50 },
      { from: 'fatima', text: 'Accepteriez-vous 85 000 FCFA ?', ago: 8, unread: true },
    ],
  },
  {
    buyer: 'moussa', seller: 'me', item: 'watch',
    deal: { status: 'concluded', requestedBy: 'me', requestedAgo: 10 * DAY, resolvedBy: 'moussa', resolvedAgo: 10 * DAY - 45 },
    messages: [
      { from: 'moussa', text: 'Bonjour, je prends la montre si elle est disponible.', ago: 12 * DAY },
      { from: 'me', text: 'Oui, rendez-vous demain à 10 h ?', ago: 12 * DAY - 30 },
      { from: 'moussa', text: 'Parfait. Merci, elle fonctionne très bien !', ago: 10 * DAY - 60 },
    ],
  },
];

const FAVORITES = ['sneakers', 'laptop', 'sofa'];

const REVIEWS = [
  { user: 'fatima', item: 'repair', rating: 5, comment: 'Réparation rapide et travail soigné.', ago: 4 * DAY },
  { user: 'moussa', item: 'watch', rating: 4, comment: 'Montre conforme à la description.', ago: 9 * DAY },
  { user: 'fatima', item: 'fabric', rating: 5, comment: 'Très beau tissu, je recommande.', ago: 2 * DAY },
  { user: 'moussa', item: 'sneakers', rating: 4, comment: 'Bon état, vendeuse agréable.', ago: 6 * DAY },
  { user: 'aicha', item: 'moto', rating: 5, comment: 'Moto bien entretenue.', ago: 3 * DAY },
];

// ─── Suppression ────────────────────────────────────────────────────────────
async function refreshCategoryStats(categoryIds) {
  await Promise.all([...new Set(categoryIds.map(String))].map(async (id) => {
    const [productsCount, servicesCount] = await Promise.all([
      Product.countDocuments({ category: id, type: 'product', status: 'active' }),
      Product.countDocuments({ category: id, type: 'service', status: 'active' }),
    ]);
    await Category.updateOne({ _id: id }, { $set: { productsCount, servicesCount } });
  }));
}

// Retire les comptes de démo et tout ce qui leur est lié.
// Les traces laissées par un testeur sur de vraies annonces (favori, avis) sont aussi retirées des compteurs.
async function wipeDemoData() {
  const userIds = (await User.find({ isDemoAccount: true }).select('_id').lean()).map((u) => u._id);
  // Garde-fou : il n'existe jamais plus d'une poignée de comptes de démo
  if (userIds.length > 10) {
    throw new Error(`${userIds.length} comptes marqués démo : anormal, rien n'a été supprimé.`);
  }
  const products = await Product.find({ seller: { $in: userIds } }).select('_id category').lean();
  const productIds = products.map((p) => p._id);

  const conversationIds = (await Conversation.find({
    $or: [{ 'participants.buyer': { $in: userIds } }, { 'participants.seller': { $in: userIds } }],
  }).select('_id').lean()).map((c) => c._id);

  const realFavorites = await Favorite.find({ user: { $in: userIds }, product: { $nin: productIds } }).select('product').lean();
  const realReviewed = await Review.distinct('item', { user: { $in: userIds }, type: 'product', item: { $nin: productIds } });

  const [messages, conversations, favorites, reviews, listings] = await Promise.all([
    Message.deleteMany({ conversationId: { $in: conversationIds } }),
    Conversation.deleteMany({ _id: { $in: conversationIds } }),
    Favorite.deleteMany({ $or: [{ user: { $in: userIds } }, { product: { $in: productIds } }] }),
    Review.deleteMany({ $or: [{ user: { $in: userIds } }, { item: { $in: [...productIds, ...userIds] } }] }),
    Product.deleteMany({ _id: { $in: productIds } }),
  ]);
  await User.deleteMany({ _id: { $in: userIds }, isDemoAccount: true });

  if (realFavorites.length) {
    await Product.updateMany(
      { _id: { $in: realFavorites.map((f) => f.product) }, favorites: { $gt: 0 } },
      { $inc: { favorites: -1 } },
      { timestamps: false }
    );
  }
  for (const id of realReviewed) {
    const product = await Product.findById(id);
    if (product) await product.updateRating(0, false);
  }
  await refreshCategoryStats(products.map((p) => p.category));

  return {
    comptes: userIds.length,
    annonces: listings.deletedCount,
    conversations: conversations.deletedCount,
    messages: messages.deletedCount,
    favoris: favorites.deletedCount,
    avis: reviews.deletedCount,
  };
}

// ─── Création ───────────────────────────────────────────────────────────────
async function createUsers(credentials, dealsByKey) {
  const users = {};
  users.me = await new User({
    phone: credentials.phone,
    email: credentials.email,
    password: credentials.password,
    name: credentials.name,
    businessType: 'professional',
    businessName: 'Boutique Test TakTak',
    description: 'Compte de démonstration pour la revue de l’application.',
    location: 'Niamey',
    contactInfo: { whatsapp: credentials.phone },
    verified: true,
    otp: { verified: true },
    isDemoAccount: true,
    sellerStats: { responseTime: '< 1h', responseRate: 96, dealsConcluded: dealsByKey.me || 0 },
    createdAt: ago(90 * DAY),
  }).save();

  for (const [key, partner] of Object.entries(PARTNERS)) {
    users[key] = await new User({
      ...partner,
      password: crypto.randomBytes(24).toString('hex'), // Personne ne se connecte à ces comptes
      isDemoAccount: true,
      sellerStats: { responseTime: '1-6h', responseRate: 88, dealsConcluded: dealsByKey[key] || 0 },
      createdAt: ago(60 * DAY),
    }).save();
  }
  return users;
}

async function createListings(users) {
  const categories = await Category.find({ slug: { $in: [...new Set(Object.values(LISTINGS).map((l) => l.category))] } }).lean();
  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  const docs = Object.entries(LISTINGS).map(([key, listing]) => {
    const category = bySlug.get(listing.category);
    if (!category) throw new Error(`Catégorie introuvable dans cette base : ${listing.category}`);
    const subcategory = (category.subcategories || []).find((s) => s.slug === listing.subcategory);
    const images = listing.images.map(photo);
    const reviews = REVIEWS.filter((r) => r.item === key);
    const date = ago(listing.age);
    return {
      _id: newId(),
      seller: users[listing.seller]._id,
      title: `Démo - ${listing.title}`,
      description: `${listing.description}${DEMO_NOTE}`,
      category: category._id,
      categorySlug: category.slug,
      subcategory: subcategory?.name,
      subcategorySlug: subcategory?.slug,
      type: listing.type,
      price: listing.price,
      location: users[listing.seller].location,
      images,
      mainImage: images[0],
      ...(listing.condition ? { condition: listing.condition } : {}),
      views: listing.views,
      favorites: FAVORITES.includes(key) ? 1 : 0,
      rating: reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0,
      totalReviews: reviews.length,
      delivery: listing.delivery,
      availability: listing.availability,
      serviceArea: listing.serviceArea,
      specifications: listing.specifications,
      status: listing.status || 'active',
      createdAt: date,
      updatedAt: date,
    };
  });

  await Product.insertMany(docs, { timestamps: false });
  await refreshCategoryStats(docs.map((d) => d.category));
  return Object.fromEntries(Object.keys(LISTINGS).map((key, i) => [key, docs[i]]));
}

async function createConversation(spec, users, products) {
  const conversationId = newId();
  const buyer = users[spec.buyer];
  const seller = users[spec.seller];
  const product = products[spec.item];
  const idOf = (key) => (key ? users[key]._id : null);
  const dateAgo = (minutes) => (minutes === undefined ? null : ago(minutes));

  const messages = spec.messages.map((m) => {
    const sender = users[m.from];
    const date = ago(m.ago);
    return {
      _id: newId(),
      conversationId,
      senderId: sender._id,
      senderName: sender.name,
      senderAvatar: sender.avatar || null,
      content: m.text,
      timestamp: date.toISOString(),
      delivered: true,
      deliveredAt: date,
      read: !m.unread,
      readAt: m.unread ? null : date,
      type: 'text',
      createdAt: date,
      updatedAt: date,
    };
  });

  // Le dernier message « normal » reste l'aperçu de la conversation (comme en production)
  const last = messages[messages.length - 1];

  const closure = {};
  if (spec.closed) {
    const date = ago(spec.closed.ago);
    const systemMessage = {
      _id: newId(),
      conversationId,
      senderId: seller._id,
      senderName: seller.name,
      content: 'Discussion clôturée',
      timestamp: date.toISOString(),
      type: 'system',
      createdAt: date,
      updatedAt: date,
    };
    messages.push(systemMessage);
    messages.sort((a, b) => a.createdAt - b.createdAt);
    closure.closedByOwner = true;
    closure.closedAt = date;
    closure.closedById = seller._id;
    closure.closureHistory = [{
      action: 'close',
      messageId: systemMessage._id,
      content: systemMessage.content,
      timestamp: systemMessage.timestamp,
      actorId: seller._id,
      actorName: seller.name,
    }];
  }

  const unreadFor = (recipient) => spec.messages.filter((m) => m.unread && m.from !== recipient).length;
  const deal = spec.deal || { status: 'open' };

  await Message.insertMany(messages, { timestamps: false });
  await Conversation.insertMany([{
    _id: conversationId,
    participants: { buyer: buyer._id, seller: seller._id },
    item: { id: product._id, title: product.title, image: product.mainImage, price: product.price },
    lastMessage: {
      id: last._id,
      content: last.content,
      senderId: String(last.senderId),
      senderName: last.senderName,
      timestamp: last.timestamp,
      delivered: true,
      deliveredAt: last.deliveredAt,
      read: last.read,
      readAt: last.readAt,
      type: 'text',
    },
    unreadCount: { buyer: unreadFor(spec.buyer), seller: unreadFor(spec.seller) },
    deal: {
      status: deal.status,
      requestedBy: idOf(deal.requestedBy),
      requestedAt: dateAgo(deal.requestedAgo),
      resolvedBy: idOf(deal.resolvedBy),
      resolvedAt: dateAgo(deal.resolvedAgo),
    },
    ...closure,
    createdAt: messages[0].createdAt,
    updatedAt: last.createdAt,
  }], { timestamps: false });
}

async function seed(credentials) {
  const dealsByKey = {};
  CONVERSATIONS.filter((c) => c.deal?.status === 'concluded').forEach((c) => {
    dealsByKey[c.seller] = (dealsByKey[c.seller] || 0) + 1;
  });

  const users = await createUsers(credentials, dealsByKey);
  const products = await createListings(users);

  for (const spec of CONVERSATIONS) {
    await createConversation(spec, users, products);
  }

  await Favorite.insertMany(FAVORITES.map((key) => ({ user: users.me._id, product: products[key]._id })));

  await Review.insertMany(REVIEWS.map((r) => {
    const date = ago(r.ago);
    return {
      user: users[r.user]._id,
      userName: users[r.user].name,
      type: 'product',
      item: products[r.item]._id,
      itemModel: 'Product',
      rating: r.rating,
      comment: r.comment,
      createdAt: date,
      updatedAt: date,
    };
  }), { timestamps: false });
}

// ─── Programme ──────────────────────────────────────────────────────────────
async function findRealAccountConflict(credentials) {
  const emails = [credentials.email, ...Object.values(PARTNERS).map((p) => p.email)];
  return User.findOne({
    isDemoAccount: { $ne: true },
    $or: [{ phone: credentials.phone }, { email: { $in: emails } }],
  }).select('_id').lean();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const credentials = args.remove ? null : validateCredentials(args);

  await mongoose.connect(process.env.MONGODB_URI);
  const target = `${mongoose.connection.host} / ${mongoose.connection.name}`;
  console.log(`Base visée : ${target}`);

  if (credentials && await findRealAccountConflict(credentials)) {
    throw new Error('Ce téléphone ou cet email appartient à un vrai compte : rien n’a été modifié. Utilisez d’autres identifiants.');
  }

  if (!args.yes) {
    console.log(args.remove
      ? 'Simulation : tous les comptes de démo et leurs données seraient supprimés.'
      : `Simulation : le compte ${credentials.phone} / ${credentials.email} serait (re)créé avec ${Object.keys(LISTINGS).length} annonces, ${CONVERSATIONS.length} conversations, ${FAVORITES.length} favoris et ${REVIEWS.length} avis.`);
    console.log('Rien n’a été modifié. Ajoutez --yes pour lancer.');
    return;
  }

  const removed = await wipeDemoData();
  console.log('Anciennes données de démo supprimées :', removed);
  if (args.remove) return;

  await seed(credentials);
  console.log('\n✅ Compte de test prêt');
  console.log(`   Téléphone : ${credentials.phone}`);
  console.log(`   Email     : ${credentials.email}`);
  console.log('   Mot de passe : celui que vous avez fourni');
}

run()
  .catch((error) => { console.error('❌', error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
