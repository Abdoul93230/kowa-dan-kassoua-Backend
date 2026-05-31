/**
 * ÉTAPE 1 : Migration Cloudinary ciblée (DB-first)
 *
 * Logique :
 * 1. Se connecte à l'ANCIENNE base MongoDB
 * 2. Scanne TOUTES les collections pour extraire uniquement les URLs
 *    Cloudinary référencées par l'app (photos produits, avatars, vocaux, etc.)
 * 3. Ne migre QUE ces URLs vers le nouveau compte Cloudinary
 * 4. Sauvegarde le mapping old_url → new_url dans migration-cloudinary-mapping.json
 *
 * Cela évite de copier les ressources des autres apps présentes dans l'ancien compte.
 *
 * NOTE: Credentials hardcodés intentionnellement — indépendant du .env.
 */

const mongoose = require('mongoose');
const cloudinaryPkg = require('cloudinary');
const fs = require('fs');
const path = require('path');

// ─── Credentials en dur ───────────────────────────────────────────────────────

// ANCIENNE base MongoDB (source)
const OLD_MONGODB_URI =
  'mongodb+srv://ihambaobab_db_user:cygqfCV8CcrGRB9@ihambaobabcluster.rucr9hc.mongodb.net/kowa-dan-kassoua-DB?retryWrites=true&w=majority';

// ANCIEN Cloudinary (source)
const OLD_CLOUD_NAME = 'dkfddtykk';
const OLD_API_KEY    = '577594384978177';
const OLD_API_SECRET = 'kGQ99p3O0iFASZZHEmFelHPVt0I';

// NOUVEAU Cloudinary (destination)
const NEW_CLOUD_NAME = 'dwlmcs8pp';
const NEW_API_KEY    = '258141819586523';
const NEW_API_SECRET = '3BYWqye_1SWBAjKMspycEqVI-ZU';

// ─────────────────────────────────────────────────────────────────────────────

const MAPPING_FILE = path.join(__dirname, 'migration-cloudinary-mapping.json');
const cloudinary = cloudinaryPkg.v2;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Extraction des URLs depuis la DB ────────────────────────────────────────

/**
 * Parcourt récursivement un objet et collecte toutes les strings
 * qui sont des URLs du vieux Cloudinary.
 */
function extractCloudinaryUrls(obj, oldCloudName, collected = new Set()) {
  if (typeof obj === 'string') {
    if (obj.includes(`res.cloudinary.com/${oldCloudName}`)) {
      collected.add(obj);
    }
    return collected;
  }
  if (Array.isArray(obj)) {
    obj.forEach(item => extractCloudinaryUrls(item, oldCloudName, collected));
    return collected;
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    Object.values(obj).forEach(v => extractCloudinaryUrls(v, oldCloudName, collected));
  }
  return collected;
}

async function extractAllUrlsFromDB(mongoUri, oldCloudName) {
  console.log('🔌 Connexion à l\'ancienne base MongoDB...');
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  console.log(`✅ Connecté : ${conn.host} / ${conn.name}\n`);

  // Collections à scanner et champs prioritaires (pour le log)
  const COLLECTIONS = [
    { name: 'users',         hint: 'avatar' },
    { name: 'products',      hint: 'images, mainImage' },
    { name: 'messages',      hint: 'attachments (images + audio), senderAvatar, offerDetails.itemImage' },
    { name: 'conversations', hint: 'item.image' },
    { name: 'reviews',       hint: 'images' },
    { name: 'categories',    hint: 'image' },
    { name: 'favorites',     hint: 'snapshot images' },
  ];

  const allUrls = new Set();

  console.log('─── Scan des collections ────────────────────────────────');
  for (const { name, hint } of COLLECTIONS) {
    const coll = conn.collection(name);
    const count = await coll.countDocuments();
    if (count === 0) {
      console.log(`   ${name.padEnd(16)} 0 docs — ignorée`);
      continue;
    }

    let found = 0;
    const cursor = coll.find({});
    for await (const doc of cursor) {
      const before = allUrls.size;
      extractCloudinaryUrls(doc, oldCloudName, allUrls);
      found += allUrls.size - before;
    }
    console.log(`   ${name.padEnd(16)} ${count} docs → ${found} URL(s) trouvée(s)  [champs: ${hint}]`);
  }

  await conn.close();
  return allUrls;
}

// ─── Migration Cloudinary ────────────────────────────────────────────────────

/**
 * Détermine le resource_type Cloudinary à partir de l'URL.
 * Les vocaux sont stockés comme "video" dans Cloudinary (audio aussi).
 */
function getResourceType(url) {
  if (url.includes('/video/upload/')) return 'video';
  if (url.includes('/raw/upload/'))  return 'raw';
  return 'image';
}

/**
 * Extrait le public_id depuis une URL Cloudinary.
 * Ex: https://res.cloudinary.com/xxx/image/upload/v123/dossier/fichier.jpg
 *   → dossier/fichier
 */
function extractPublicId(url) {
  try {
    // Supprimer les paramètres de transformation (tout avant /upload/)
    const afterUpload = url.split('/upload/')[1];
    if (!afterUpload) return null;
    // Supprimer la version (v123456/) si présente
    const withoutVersion = afterUpload.replace(/^v\d+\//, '');
    // Supprimer l'extension
    const withoutExt = withoutVersion.replace(/\.[^/.]+$/, '');
    return withoutExt;
  } catch (_) {
    return null;
  }
}

async function migrateUrls(urlSet, urlMapping) {
  const toMigrate = [...urlSet].filter(url => !urlMapping[url]);
  const alreadyDone = urlSet.size - toMigrate.length;

  console.log(`\n📊 URLs à migrer : ${toMigrate.length}`);
  if (alreadyDone > 0) console.log(`⏭️  Déjà migrées  : ${alreadyDone}`);
  console.log('');

  if (toMigrate.length === 0) {
    console.log('🎉 Tout est déjà migré !');
    return { done: 0, errors: 0 };
  }

  // Configurer sur le NOUVEAU Cloudinary pour l'upload
  cloudinary.config({
    cloud_name: NEW_CLOUD_NAME,
    api_key:    NEW_API_KEY,
    api_secret: NEW_API_SECRET,
  });

  let done = 0, errors = 0;
  const errorLog = [];

  for (let i = 0; i < toMigrate.length; i++) {
    const oldUrl = toMigrate[i];
    const rtype = getResourceType(oldUrl);
    const publicId = extractPublicId(oldUrl);
    const idx = `[${alreadyDone + i + 1}/${urlSet.size}]`;
    const label = publicId || oldUrl.split('/').pop();

    process.stdout.write(`   ${idx} ${rtype}/${label} ... `);

    try {
      const uploadResult = await cloudinary.uploader.upload(oldUrl, {
        public_id:     publicId,
        resource_type: rtype,
        overwrite:     true,
      });

      urlMapping[oldUrl] = uploadResult.secure_url;
      console.log('✅');
      done++;

      if (done % 10 === 0) {
        fs.writeFileSync(MAPPING_FILE, JSON.stringify(urlMapping, null, 2));
      }

      await sleep(200);

    } catch (err) {
      console.log(`❌ ${err.message}`);
      errors++;
      errorLog.push({ url: oldUrl, error: err.message });
    }
  }

  // Sauvegarde finale
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(urlMapping, null, 2));

  if (errorLog.length > 0) {
    console.log('\n⚠️  URLs en erreur :');
    errorLog.forEach(e => console.log(`   - ${e.url.slice(0, 80)} : ${e.error}`));
  }

  return { done, errors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  MIGRATION CLOUDINARY — MODE DB-FIRST                ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`📤 ANCIEN Cloudinary : ${OLD_CLOUD_NAME}`);
  console.log(`📥 NOUVEAU Cloudinary : ${NEW_CLOUD_NAME}\n`);

  // Charger mapping existant (reprise après interruption)
  let urlMapping = {};
  if (fs.existsSync(MAPPING_FILE)) {
    try {
      urlMapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
      const n = Object.keys(urlMapping).length;
      if (n > 0) console.log(`♻️  Mapping existant : ${n} URL(s) déjà migrée(s)\n`);
    } catch (_) {
      console.log('⚠️  Mapping illisible, on repart de zéro.\n');
    }
  }

  // 1. Scanner la DB pour trouver les URLs réellement utilisées
  console.log('─── PHASE 1 : Scan de la base de données ────────────────');
  const urlsFromDB = await extractAllUrlsFromDB(OLD_MONGODB_URI, OLD_CLOUD_NAME);
  console.log(`\n🔗 Total URLs Cloudinary utilisées par l'app : ${urlsFromDB.size}\n`);

  if (urlsFromDB.size === 0) {
    console.log('ℹ️  Aucune URL Cloudinary trouvée dans la DB.');
    console.log('   Vérifiez que la connexion à l\'ancienne DB est correcte.');
    process.exit(0);
  }

  // 2. Migrer uniquement ces URLs
  console.log('─── PHASE 2 : Copie vers le nouveau Cloudinary ──────────');
  const { done, errors } = await migrateUrls(urlsFromDB, urlMapping);

  // 3. Résumé
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RÉSUMÉ                                               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`✅ Migrés avec succès : ${done}`);
  console.log(`❌ Erreurs            : ${errors}`);
  console.log(`📄 Mapping sauvegardé : ${MAPPING_FILE}`);

  if (errors === 0 && done + Object.keys(urlMapping).length >= urlsFromDB.size) {
    console.log('\n🎉 Migration Cloudinary terminée !');
    console.log('👉 Lancez maintenant : node migrate-2-mongodb-to-new.js');
  } else if (errors > 0) {
    console.log('\n⚠️  Certains assets ont échoué. Relancez pour réessayer.');
  }
}

// ─── Confirmation ─────────────────────────────────────────────────────────────

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  ÉTAPE 1/2 — Migration Cloudinary (DB-first)         ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`\nANCIEN : ${OLD_CLOUD_NAME}  →  NOUVEAU : ${NEW_CLOUD_NAME}\n`);
console.log('Ce script va :');
console.log('  1. Scanner l\'ancienne DB pour trouver UNIQUEMENT les URLs de l\'app');
console.log('  2. Copier seulement ces assets sur le nouveau Cloudinary');
console.log('  3. Ignorer toutes les autres ressources de l\'ancien compte\n');

readline.question('Continuer ? (oui/non) : ', answer => {
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
