// Migration : rendre l'index unique "phone" sparse
// Nécessaire pour les comptes créés par email (sans numéro de téléphone) :
// un index unique non-sparse n'accepte qu'un seul document sans "phone".
//
// Usage : node migrate-phone-index-sparse.js

require('dotenv').config();
const mongoose = require('mongoose');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ MongoDB connecté: ${mongoose.connection.host}`);

  const users = mongoose.connection.collection('users');
  const indexes = await users.indexes();
  const phoneIndex = indexes.find((idx) => idx.key && idx.key.phone === 1 && Object.keys(idx.key).length === 1);

  if (phoneIndex && phoneIndex.unique && phoneIndex.sparse) {
    console.log('ℹ️  Index phone déjà unique + sparse, rien à faire.');
    return;
  }

  // Les documents avec phone: null explicite bloqueraient l'index sparse
  const nullPhones = await users.countDocuments({ phone: null, email: { $exists: true } });
  if (nullPhones > 0) {
    const result = await users.updateMany({ phone: null }, { $unset: { phone: '' } });
    console.log(`🧹 ${result.modifiedCount} document(s) avec phone: null nettoyé(s)`);
  }

  if (phoneIndex) {
    console.log(`🗑️  Suppression de l'index ${phoneIndex.name}...`);
    await users.dropIndex(phoneIndex.name);
  }

  await users.createIndex({ phone: 1 }, { unique: true, sparse: true, name: 'phone_1' });
  console.log('✅ Index phone_1 recréé (unique + sparse)');
};

run()
  .catch((err) => {
    console.error('❌ Migration échouée:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
