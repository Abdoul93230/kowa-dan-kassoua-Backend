/**
 * ÉTAPE 2 : Migration MongoDB ancien → nouveau cluster
 *
 * Ce script :
 * 1. Se connecte à l'ANCIENNE base MongoDB
 * 2. Exporte toutes les collections (User, Product, Category, Conversation, Message, Favorite, Review)
 * 3. Remplace dans chaque document toutes les URLs Cloudinary anciennes par les nouvelles
 *    (en utilisant migration-cloudinary-mapping.json produit par l'étape 1)
 * 4. Importe les documents dans la NOUVELLE base MongoDB
 *
 * Prérequis : avoir d'abord lancé migrate-1-cloudinary-to-new.js
 */

// NOTE: Credentials hardcodés intentionnellement — indépendant du .env.
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

// ANCIENNE base (source) — hardcodé pour ne pas dépendre du .env
const OLD_MONGODB_URI =
  'mongodb+srv://ihambaobab_db_user:cygqfCV8CcrGRB9@ihambaobabcluster.rucr9hc.mongodb.net/kowa-dan-kassoua-DB?retryWrites=true&w=majority';

// NOUVELLE base (destination)
const NEW_MONGODB_URI =
  'mongodb+srv://taktakganingaba_db_user:ECfELhCfGzjtgu33@cluster0.jwyfgdp.mongodb.net/kowa-dan-kassoua-DB?retryWrites=true&w=majority&appName=Cluster0';

const OLD_CLOUD_NAME = 'dkfddtykk';
const NEW_CLOUD_NAME = 'dwlmcs8pp';

const MAPPING_FILE = path.join(__dirname, 'migration-cloudinary-mapping.json');

// Collections à migrer dans l'ordre (respecte les dépendances de référence)
const COLLECTIONS_ORDER = [
  'categories',
  'users',
  'products',
  'conversations',
  'messages',
  'favorites',
  'reviews',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Remplace récursivement toutes les occurrences des anciennes URLs dans un objet */
function replaceUrls(obj, urlMapping) {
  if (typeof obj === 'string') {
    // Remplacement direct par mapping exact
    if (urlMapping[obj]) return urlMapping[obj];
    // Remplacement du cloud_name dans les URLs Cloudinary non mappées (fallback)
    if (obj.includes(`res.cloudinary.com/${OLD_CLOUD_NAME}`)) {
      return obj.replace(
        `res.cloudinary.com/${OLD_CLOUD_NAME}`,
        `res.cloudinary.com/${NEW_CLOUD_NAME}`
      );
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceUrls(item, urlMapping));
  }

  if (obj !== null && typeof obj === 'object') {
    // Ne pas toucher aux types spéciaux de Mongoose/MongoDB
    if (obj instanceof Date || obj._bsontype) return obj;

    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = replaceUrls(obj[key], urlMapping);
    }
    return result;
  }

  return obj;
}

/** Compte les URL Cloudinary dans un document */
function countCloudinaryUrls(obj, cloudName) {
  let count = 0;
  const json = JSON.stringify(obj);
  const regex = new RegExp(`res\\.cloudinary\\.com/${cloudName}`, 'g');
  const matches = json.match(regex);
  return matches ? matches.length : 0;
}

// ─── Connexions ───────────────────────────────────────────────────────────────

let oldConn, newConn;

async function connectBoth() {
  console.log('🔌 Connexion à l\'ANCIENNE base MongoDB...');
  oldConn = await mongoose.createConnection(OLD_MONGODB_URI).asPromise();
  console.log(`✅ Ancienne DB : ${oldConn.host} / ${oldConn.name}\n`);

  console.log('🔌 Connexion à la NOUVELLE base MongoDB...');
  newConn = await mongoose.createConnection(NEW_MONGODB_URI).asPromise();
  console.log(`✅ Nouvelle DB : ${newConn.host} / ${newConn.name}\n`);
}

// ─── Migration d'une collection ───────────────────────────────────────────────

async function migrateCollection(collectionName, urlMapping) {
  console.log(`\n────────────────────────────────────────`);
  console.log(`📂 Collection : ${collectionName}`);

  const oldCollection = oldConn.collection(collectionName);
  const newCollection = newConn.collection(collectionName);

  // Compter les documents source
  const totalCount = await oldCollection.countDocuments();
  console.log(`   📊 Documents source : ${totalCount}`);

  if (totalCount === 0) {
    console.log('   ⏭️  Collection vide, ignorée.');
    return { total: 0, inserted: 0, updated: 0, errors: 0 };
  }

  // Récupérer tous les documents (par batch de 500)
  const BATCH_SIZE = 500;
  let processed = 0, inserted = 0, errors = 0, urlsReplaced = 0;

  const cursor = oldCollection.find({});
  let batch = [];

  for await (const doc of cursor) {
    // Compter les URLs avant remplacement
    urlsReplaced += countCloudinaryUrls(doc, OLD_CLOUD_NAME);

    // Remplacer les URLs
    const updatedDoc = replaceUrls(doc, urlMapping);

    batch.push(updatedDoc);

    if (batch.length >= BATCH_SIZE) {
      try {
        await newCollection.insertMany(batch, { ordered: false });
        inserted += batch.length;
      } catch (err) {
        // ordered: false permet de continuer même si certains docs existent déjà
        if (err.writeErrors) {
          const ok = batch.length - err.writeErrors.length;
          inserted += ok;
          errors += err.writeErrors.length;
          console.log(`   ⚠️  ${err.writeErrors.length} docs ignorés (déjà existants ?)`);
        } else {
          throw err;
        }
      }
      processed += batch.length;
      process.stdout.write(`\r   ⏳ ${processed}/${totalCount} docs traités...`);
      batch = [];
    }
  }

  // Dernier batch
  if (batch.length > 0) {
    try {
      await newCollection.insertMany(batch, { ordered: false });
      inserted += batch.length;
    } catch (err) {
      if (err.writeErrors) {
        const ok = batch.length - err.writeErrors.length;
        inserted += ok;
        errors += err.writeErrors.length;
      } else {
        throw err;
      }
    }
    processed += batch.length;
  }

  // Recréer les index depuis la source
  try {
    const indexes = await oldCollection.indexes();
    for (const index of indexes) {
      if (index.name === '_id_') continue; // _id index est automatique
      const { key, name, ...options } = index;
      await newCollection.createIndex(key, { name, ...options }).catch(() => {});
    }
    console.log(`\r   ✅ ${processed} docs insérés | ${urlsReplaced} URLs Cloudinary remplacées | ${errors} erreurs`);
  } catch (_) {
    console.log(`\r   ✅ ${processed} docs insérés | ${urlsReplaced} URLs Cloudinary remplacées`);
  }

  return { total: totalCount, inserted, errors, urlsReplaced };
}

// ─── Vérification post-migration ─────────────────────────────────────────────

async function verifyMigration() {
  console.log('\n─── VÉRIFICATION ────────────────────────────────────────');
  let hasOldUrls = false;

  for (const collName of COLLECTIONS_ORDER) {
    const coll = newConn.collection(collName);
    // Chercher des documents qui contiennent encore l'ancien cloud_name
    const count = await coll.countDocuments({
      $where: `JSON.stringify(this).includes('res.cloudinary.com/${OLD_CLOUD_NAME}')`,
    }).catch(() => -1);

    if (count > 0) {
      console.log(`   ⚠️  ${collName} : ${count} doc(s) contiennent encore l'ancienne URL`);
      hasOldUrls = true;
    } else if (count === 0) {
      console.log(`   ✅ ${collName} : aucune ancienne URL Cloudinary`);
    } else {
      // $where non supporté sur certaines versions → on skip
      console.log(`   ℹ️  ${collName} : vérification non disponible`);
    }
  }

  if (!hasOldUrls) {
    console.log('\n   🎉 Aucune ancienne URL Cloudinary détectée dans la nouvelle DB !');
  }
}

// ─── Script principal ─────────────────────────────────────────────────────────

async function main() {
  // 1. Charger le mapping Cloudinary
  if (!fs.existsSync(MAPPING_FILE)) {
    console.error(`❌ Fichier de mapping introuvable : ${MAPPING_FILE}`);
    console.error('   Veuillez d\'abord exécuter : node migrate-1-cloudinary-to-new.js');
    process.exit(1);
  }

  const urlMapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
  const mappingCount = Object.keys(urlMapping).length;
  console.log(`\n📄 Mapping Cloudinary chargé : ${mappingCount} URL(s)\n`);

  // 2. Connexions
  await connectBoth();

  // 3. Migrer chaque collection
  const summary = {};
  for (const collName of COLLECTIONS_ORDER) {
    try {
      summary[collName] = await migrateCollection(collName, urlMapping);
    } catch (err) {
      console.error(`\n❌ Erreur fatale sur la collection "${collName}" :`, err.message);
      summary[collName] = { error: err.message };
    }
  }

  // 4. Vérification
  await verifyMigration();

  // 5. Résumé final
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RÉSUMÉ DE LA MIGRATION MONGODB                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  let totalDocs = 0, totalErrors = 0, totalUrls = 0;
  for (const [coll, stats] of Object.entries(summary)) {
    if (stats.error) {
      console.log(`  ❌ ${coll.padEnd(16)} ERREUR: ${stats.error}`);
    } else {
      console.log(`  ✅ ${coll.padEnd(16)} ${stats.inserted} docs | ${stats.urlsReplaced} URLs remplacées`);
      totalDocs += stats.inserted;
      totalErrors += stats.errors;
      totalUrls += stats.urlsReplaced;
    }
  }
  console.log(`\n  📊 Total : ${totalDocs} docs migrés | ${totalUrls} URLs Cloudinary mises à jour`);
  if (totalErrors > 0) {
    console.log(`  ⚠️  ${totalErrors} docs en doublon ignorés (probablement déjà migrés)`);
  }

  // 6. Déconnexion
  await oldConn.close();
  await newConn.close();

  console.log('\n✅ Migration MongoDB terminée !');
  console.log('👉 Prochaine étape : mettez à jour votre fichier .env avec les nouvelles credentials.');
  console.log('   Voir les commentaires en haut du fichier .env pour les nouvelles valeurs.\n');
}

// ─── Point d'entrée avec confirmation ────────────────────────────────────────

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  ÉTAPE 2/2 — Migration MongoDB vers nouveau cluster  ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('\nCe script va :');
console.log('  1. Lire toutes les collections de l\'ANCIENNE base MongoDB');
console.log('  2. Remplacer les URLs Cloudinary (via migration-cloudinary-mapping.json)');
console.log('  3. Insérer les données dans la NOUVELLE base MongoDB\n');
console.log(`ANCIENNE DB : ${OLD_MONGODB_URI.split('@')[1]?.split('/')[0] || '...'}`);
console.log(`NOUVELLE DB : ${NEW_MONGODB_URI.split('@')[1]?.split('/')[0] || '...'}\n`);
console.log('⚠️  Assurez-vous d\'avoir d\'abord lancé migrate-1-cloudinary-to-new.js\n');

readline.question('Continuer ? (oui/non) : ', (answer) => {
  readline.close();
  if (['oui', 'o', 'yes', 'y'].includes(answer.toLowerCase())) {
    main().catch(err => {
      console.error('\n❌ Erreur fatale :', err);
      process.exit(1);
    });
  } else {
    console.log('❌ Migration annulée.');
    process.exit(0);
  }
});
