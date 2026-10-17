// Indique pour chaque catégorie / sous-catégorie si l'on peut y publier des produits,
// des services ou les deux (champ `types`), et crée les sous-catégories manquantes
// pour que chaque catégorie propose quelque chose aux deux. Données : category-types.json.
//
// Usage :
//   node set-category-types.js            -> SIMULATION : affiche les changements, n'écrit rien
//   node set-category-types.js --apply    -> applique
// Base visée : MONGODB_URI (ou TARGET_MONGODB_URI si défini).
// Rien n'est supprimé ; une sous-catégorie qui existe déjà (même slug) n'est pas recréée.

require('dotenv').config();
const mongoose = require('mongoose');
const data = require('./category-types.json');

const APPLY = process.argv.includes('--apply');
const URI = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI;
const BOTH = ['product', 'service'];
const SERVICE_CATEGORIES = new Set(data.serviceCategories || []);

const typesFor = (catSlug, subSlug) => (
  SERVICE_CATEGORIES.has(catSlug) ? ['service'] : data.types[`${catSlug}/${subSlug}`] || BOTH
);
const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

async function run() {
  if (!URI) throw new Error('Définissez MONGODB_URI (ou TARGET_MONGODB_URI).');
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const host = URI.replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split('?')[0];
  console.log(`Base : ${host} (${db.databaseName})`);
  console.log(APPLY ? '⚙️  MODE APPLICATION\n' : '🔍 MODE SIMULATION — rien ne sera écrit (ajoutez --apply)\n');

  const categories = await db.collection('categories').find({}).toArray();
  let changes = 0;

  for (const cat of categories) {
    const set = {};
    const subs = cat.subcategories || [];

    // Types des sous-catégories existantes
    subs.forEach((sub, i) => {
      const types = typesFor(cat.slug, sub.slug);
      if (!same(sub.types, types)) set[`subcategories.${i}.types`] = types;
    });

    // Sous-catégories à créer (une seule fois)
    const existing = new Set(subs.map((s) => s.slug));
    const toAdd = (data.add[cat.slug] || [])
      .filter((s) => !existing.has(s.slug))
      .map((s) => ({ _id: new mongoose.Types.ObjectId(), name: s.name, slug: s.slug, icon: s.icon, types: s.types, active: true }));

    // Types de la catégorie : réunion de ceux de ses sous-catégories
    const all = [...subs.map((s) => typesFor(cat.slug, s.slug)), ...toAdd.map((s) => s.types)].flat();
    const catTypes = BOTH.filter((t) => all.includes(t));
    if (catTypes.length && !same(cat.types, catTypes)) set.types = catTypes;

    const n = Object.keys(set).length + toAdd.length;
    if (!n) continue;
    changes += n;

    const subChanges = Object.keys(set).filter((k) => k.startsWith('subcategories.')).length;
    console.log(`• ${cat.name} — ${subChanges} sous-catégorie(s) classée(s)${set.types ? `, catégorie : ${set.types.join(' + ')}` : ''}`);
    toAdd.forEach((s) => console.log(`    + ${s.icon} ${s.name} (${s.types.join(' + ')})`));

    if (!APPLY) continue;
    // Deux écritures : MongoDB refuse de modifier et d'allonger le même tableau en une seule
    if (Object.keys(set).length) await db.collection('categories').updateOne({ _id: cat._id }, { $set: set });
    if (toAdd.length) await db.collection('categories').updateOne({ _id: cat._id }, { $push: { subcategories: { $each: toAdd } } });
  }

  console.log(`\n${changes} modification(s) ${APPLY ? 'appliquée(s)' : 'à appliquer'}.`);
  if (APPLY && changes) console.log('Redémarrez le backend pour vider le cache des catégories.');
}

run()
  .catch((error) => { console.error('❌ Échec :', error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
