// Enregistre l'icône (emoji) de chaque catégorie et sous-catégorie, d'après category-icons.json.
// Le web et l'app mobile affichent l'illustration 3D correspondant à cet emoji.
//
// Usage :
//   node set-category-icons.js            -> SIMULATION : affiche les changements, n'écrit rien
//   node set-category-icons.js --apply    -> applique
// Base visée : MONGODB_URI (ou TARGET_MONGODB_URI si défini).
// Seul le champ `icon` est modifié ; les catégories absentes du fichier sont laissées telles quelles.

require('dotenv').config();
const mongoose = require('mongoose');
const { bySlug } = require('./category-icons.json');

const APPLY = process.argv.includes('--apply');
const URI = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI;

async function run() {
  if (!URI) throw new Error('Définissez MONGODB_URI (ou TARGET_MONGODB_URI).');
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const host = URI.replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split('?')[0];
  console.log(`Base : ${host} (${db.databaseName})`);
  console.log(APPLY ? '⚙️  MODE APPLICATION\n' : '🔍 MODE SIMULATION — rien ne sera écrit (ajoutez --apply)\n');

  const categories = await db.collection('categories').find({}).toArray();
  let changes = 0;
  const unknown = [];

  for (const cat of categories) {
    const set = {};
    const catEmoji = bySlug[cat.slug];
    if (!catEmoji) unknown.push(cat.slug);
    else if (cat.icon !== catEmoji) {
      set.icon = catEmoji;
      console.log(`  ${cat.name.padEnd(28)} ${String(cat.icon || '—').padEnd(16)} -> ${catEmoji}`);
    }

    (cat.subcategories || []).forEach((sub, i) => {
      const subEmoji = bySlug[`${cat.slug}/${sub.slug}`];
      if (!subEmoji) { if (catEmoji) unknown.push(`${cat.slug}/${sub.slug}`); return; }
      if (sub.icon !== subEmoji) {
        set[`subcategories.${i}.icon`] = subEmoji;
        console.log(`    · ${sub.name.padEnd(24)} ${String(sub.icon || '—').padEnd(16)} -> ${subEmoji}`);
      }
    });

    const n = Object.keys(set).length;
    if (!n) continue;
    changes += n;
    if (APPLY) await db.collection('categories').updateOne({ _id: cat._id }, { $set: set });
  }

  console.log(`\n${changes} icône(s) ${APPLY ? 'mises à jour' : 'à mettre à jour'}.`);
  if (unknown.length) console.log(`ℹ️  Sans icône dans le fichier (inchangées) : ${unknown.join(', ')}`);
  if (APPLY && changes) console.log('Pensez à redémarrer le backend (cache des catégories).');
}

run()
  .catch((error) => { console.error('❌ Échec :', error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
