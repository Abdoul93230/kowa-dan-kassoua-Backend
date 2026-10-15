// Clone des données DEV -> PROD (utilisateurs, annonces, favoris, conversations, messages, avis)
//
// • Les catégories ne sont PAS copiées : chaque annonce est rattachée aux catégories qui
//   existent déjà en prod, via clone-category-mapping.json (modifiable).
// • Rien n'est supprimé ni écrasé en prod : un document déjà présent (même _id) est ignoré,
//   un utilisateur qui existe déjà en prod (même téléphone ou e-mail) garde ses valeurs de prod
//   et toutes ses données dev (annonces, messages…) lui sont rattachées.
// • Les identifiants (_id) sont conservés : relancer le script ne crée pas de doublons.
// • Les sessions de dev (refresh tokens) ne sont pas copiées ; les mots de passe, si.
//
// Usage :
//   SOURCE_MONGODB_URI="mongodb+srv://...dev"  TARGET_MONGODB_URI="mongodb+srv://...prod"  node clone-dev-to-prod.js
//       -> SIMULATION : affiche ce qui serait fait, n'écrit rien
//   ... node clone-dev-to-prod.js --apply
//       -> applique
// Option : --mapping=chemin/vers/mapping.json

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const mappingArg = process.argv.find((a) => a.startsWith('--mapping='));
const MAPPING_FILE = mappingArg ? mappingArg.split('=')[1] : path.join(__dirname, 'clone-category-mapping.json');

const SOURCE_URI = process.env.SOURCE_MONGODB_URI || process.env.MONGODB_URI;
const TARGET_URI = process.env.TARGET_MONGODB_URI;

const COPIED = ['users', 'products', 'favorites', 'conversations', 'messages', 'reviews'];
const BATCH = 500;

const hostOf = (uri) => String(uri || '').replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split('?')[0];
const idStr = (v) => (v == null ? '' : String(v));
const isBase64Image = (v) => typeof v === 'string' && /^data:image\//i.test(v);

const stats = {};
const count = (col, key, n = 1) => {
  stats[col] = stats[col] || {};
  stats[col][key] = (stats[col][key] || 0) + n;
};

async function insertBatch(target, col, docs) {
  if (!docs.length) return;
  if (!APPLY) { count(col, 'à insérer', docs.length); return; }
  for (let i = 0; i < docs.length; i += BATCH) {
    try {
      const res = await target.collection(col).insertMany(docs.slice(i, i + BATCH), { ordered: false });
      count(col, 'insérés', res.insertedCount);
    } catch (error) {
      // Doublons (index uniques) : les autres documents du lot sont quand même insérés
      const inserted = error.result?.insertedCount ?? error.insertedCount ?? 0;
      count(col, 'insérés', inserted);
      count(col, 'ignorés (doublon)', (error.writeErrors?.length) || 0);
      if (!error.writeErrors) throw error;
    }
  }
}

async function existingIds(target, col, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 1000) {
    const docs = await target.collection(col).find({ _id: { $in: ids.slice(i, i + 1000) } }, { projection: { _id: 1 } }).toArray();
    docs.forEach((d) => found.add(idStr(d._id)));
  }
  return found;
}

async function run() {
  if (!SOURCE_URI || !TARGET_URI) {
    throw new Error('Définissez SOURCE_MONGODB_URI (dev) et TARGET_MONGODB_URI (prod).');
  }
  if (hostOf(SOURCE_URI) === hostOf(TARGET_URI)) {
    throw new Error('La source et la cible sont la même base : opération refusée.');
  }

  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
  const source = (await mongoose.createConnection(SOURCE_URI).asPromise()).db;
  const target = (await mongoose.createConnection(TARGET_URI).asPromise()).db;

  console.log(`Source (dev)  : ${hostOf(SOURCE_URI)}`);
  console.log(`Cible  (prod) : ${hostOf(TARGET_URI)}`);
  console.log(APPLY ? '⚙️  MODE APPLICATION — la prod va être modifiée\n' : '🔍 MODE SIMULATION — rien ne sera écrit (ajoutez --apply)\n');

  const others = (await source.listCollections().toArray()).map((c) => c.name).filter((n) => !COPIED.includes(n) && n !== 'categories');
  if (others.length) console.log(`ℹ️  Collections non copiées : ${others.join(', ')}\n`);

  // ─── Catégories : dev (slug) -> prod (id + slug + sous-catégorie) ───────────
  const devCategories = await source.collection('categories').find({}).toArray();
  const devCatById = new Map(devCategories.map((c) => [idStr(c._id), c]));
  const prodCategories = await target.collection('categories').find({}).toArray();
  const prodCatBySlug = new Map(prodCategories.map((c) => [c.slug, c]));

  const resolveTarget = (ref) => {
    const [catSlug, subSlug] = String(ref).split('/');
    const cat = prodCatBySlug.get(catSlug);
    if (!cat) throw new Error(`Catégorie prod introuvable dans la cible : « ${catSlug} » (vérifiez le fichier de correspondance)`);
    const sub = (cat.subcategories || []).find((s) => s.slug === subSlug);
    if (subSlug && !sub) throw new Error(`Sous-catégorie prod introuvable : « ${ref} »`);
    return { cat, sub };
  };
  // Vérifie toutes les cibles du fichier avant de commencer
  [...Object.values(mapping.map), mapping.fallback, ...(mapping.titleRules || []).map((r) => r.target)].forEach(resolveTarget);

  const usedMappings = new Map();
  const mapCategory = (product) => {
    const devCat = devCatById.get(idStr(product.category));
    const catSlug = devCat?.slug || product.categorySlug || '';
    const subSlug = product.subcategorySlug || product.subcategory || '';
    const rule = (mapping.titleRules || []).find((r) => r.devCategory === catSlug && new RegExp(r.pattern, 'i').test(product.title || ''));
    const ref = rule?.target || mapping.map[`${catSlug}/${subSlug}`] || mapping.map[`${catSlug}/*`] || mapping.fallback;
    const key = `${catSlug}/${subSlug || '-'}  ->  ${ref}${ref === mapping.fallback && !mapping.map[`${catSlug}/*`] ? '   ⚠️ (par défaut)' : ''}`;
    usedMappings.set(key, (usedMappings.get(key) || 0) + 1);
    return resolveTarget(ref);
  };

  // ─── Utilisateurs : fusion avec les comptes prod existants (téléphone / e-mail) ─
  const userMap = new Map(); // id dev -> id prod
  const devUsers = await source.collection('users').find({}).toArray();
  const prodUsersExisting = await existingIds(target, 'users', devUsers.map((u) => u._id));
  const toInsertUsers = [];
  for (const u of devUsers) {
    if (prodUsersExisting.has(idStr(u._id))) { userMap.set(idStr(u._id), u._id); count('users', 'déjà en prod (même _id)'); continue; }
    const or = [u.phone && { phone: u.phone }, u.email && { email: u.email }].filter(Boolean);
    const twin = or.length ? await target.collection('users').findOne({ $or: or }, { projection: { _id: 1 } }) : null;
    if (twin) { userMap.set(idStr(u._id), twin._id); count('users', 'fusionnés avec un compte prod'); continue; }
    userMap.set(idStr(u._id), u._id);
    const { refreshToken, refreshTokens, ...clean } = u; // sessions de dev non copiées
    toInsertUsers.push(clean);
  }
  const mapUser = (id) => (id == null ? id : (userMap.get(idStr(id)) ?? id));
  await insertBatch(target, 'users', toInsertUsers);

  // ─── Annonces : vendeur + catégories prod ────────────────────────────────────
  const devProducts = await source.collection('products').find({}).toArray();
  const prodProductsExisting = await existingIds(target, 'products', devProducts.map((p) => p._id));
  const toInsertProducts = [];
  for (const p of devProducts) {
    if (prodProductsExisting.has(idStr(p._id))) { count('products', 'déjà en prod (ignorés)'); continue; }
    const { cat, sub } = mapCategory(p);
    toInsertProducts.push({
      ...p,
      seller: mapUser(p.seller),
      category: cat._id,
      categorySlug: cat.slug,
      subcategory: sub ? sub.slug : '',
      subcategorySlug: sub ? sub.slug : '',
    });
  }
  await insertBatch(target, 'products', toInsertProducts);

  // ─── Favoris ─────────────────────────────────────────────────────────────────
  const devFavorites = await source.collection('favorites').find({}).toArray();
  const prodFavExisting = await existingIds(target, 'favorites', devFavorites.map((f) => f._id));
  await insertBatch(target, 'favorites', devFavorites
    .filter((f) => { const keep = !prodFavExisting.has(idStr(f._id)); if (!keep) count('favorites', 'déjà en prod (ignorés)'); return keep; })
    .map((f) => ({ ...f, user: mapUser(f.user) })));

  // ─── Conversations ───────────────────────────────────────────────────────────
  const devConversations = await source.collection('conversations').find({}).toArray();
  const prodConvExisting = await existingIds(target, 'conversations', devConversations.map((c) => c._id));
  await insertBatch(target, 'conversations', devConversations
    .filter((c) => { const keep = !prodConvExisting.has(idStr(c._id)); if (!keep) count('conversations', 'déjà en prod (ignorées)'); return keep; })
    .map((c) => ({
      ...c,
      participants: { ...c.participants, buyer: mapUser(c.participants?.buyer), seller: mapUser(c.participants?.seller) },
      lastMessage: c.lastMessage ? { ...c.lastMessage, senderId: c.lastMessage.senderId ? idStr(mapUser(c.lastMessage.senderId)) : c.lastMessage.senderId } : c.lastMessage,
      deal: c.deal ? { ...c.deal, requestedBy: mapUser(c.deal.requestedBy), resolvedBy: mapUser(c.deal.resolvedBy) } : c.deal,
      closedById: mapUser(c.closedById),
      closureHistory: (c.closureHistory || []).map((h) => ({ ...h, actorId: mapUser(h.actorId) })),
    })));

  // ─── Messages (les photos base64 recopiées dans les messages sont retirées) ──
  const msgCursor = source.collection('messages').find({});
  let msgBatch = [];
  const flushMessages = async () => {
    const existing = await existingIds(target, 'messages', msgBatch.map((m) => m._id));
    const fresh = msgBatch.filter((m) => !existing.has(idStr(m._id)));
    count('messages', 'déjà en prod (ignorés)', msgBatch.length - fresh.length);
    await insertBatch(target, 'messages', fresh.map((m) => ({
      ...m,
      senderId: mapUser(m.senderId),
      senderAvatar: isBase64Image(m.senderAvatar) ? null : m.senderAvatar,
    })));
    msgBatch = [];
  };
  for await (const m of msgCursor) {
    msgBatch.push(m);
    if (msgBatch.length >= BATCH) await flushMessages();
  }
  if (msgBatch.length) await flushMessages();

  // ─── Avis ────────────────────────────────────────────────────────────────────
  const devReviews = await source.collection('reviews').find({}).toArray();
  const prodRevExisting = await existingIds(target, 'reviews', devReviews.map((r) => r._id));
  await insertBatch(target, 'reviews', devReviews
    .filter((r) => { const keep = !prodRevExisting.has(idStr(r._id)); if (!keep) count('reviews', 'déjà en prod (ignorés)'); return keep; })
    .map((r) => ({ ...r, user: mapUser(r.user), item: r.itemModel === 'User' ? mapUser(r.item) : r.item })));

  // ─── Compteurs des catégories prod ───────────────────────────────────────────
  if (APPLY) {
    for (const cat of prodCategories) {
      const [productsCount, servicesCount] = await Promise.all([
        target.collection('products').countDocuments({ category: cat._id, type: 'product', status: 'active' }),
        target.collection('products').countDocuments({ category: cat._id, type: 'service', status: 'active' }),
      ]);
      await target.collection('categories').updateOne({ _id: cat._id }, { $set: { productsCount, servicesCount } });
    }
    console.log('📊 Compteurs des catégories prod recalculés');
  }

  // ─── Rapport ─────────────────────────────────────────────────────────────────
  console.log('\nCorrespondance des catégories appliquée aux annonces :');
  [...usedMappings.entries()].sort().forEach(([k, n]) => console.log(`  ${String(n).padStart(4)} × ${k}`));
  console.log('\nRésumé par collection :');
  COPIED.forEach((col) => {
    const s = stats[col] || {};
    const parts = Object.entries(s).map(([k, v]) => `${v} ${k}`);
    console.log(`  ${col.padEnd(14)} ${parts.length ? parts.join(' · ') : 'rien à faire'}`);
  });
  if (!APPLY) console.log('\n✅ Simulation terminée. Relancez avec --apply pour écrire en prod.');
  else console.log('\n✅ Clonage terminé. Pensez à redémarrer le backend de prod (cache de l\'accueil).');

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('❌ Échec :', error.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
