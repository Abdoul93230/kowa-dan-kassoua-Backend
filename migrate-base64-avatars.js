// Migration : photos de profil enregistrées en base64 → Cloudinary
//
// D'anciens comptes ont leur photo stockée directement dans la base
// (« data:image/...;base64,… », plusieurs centaines de Ko). Elle était recopiée dans
// chaque message envoyé (senderAvatar) et alourdissait toutes les réponses.
// Ce script envoie chaque photo sur Cloudinary, puis remplace le base64 par l'URL
// dans le profil ET dans les messages de cet utilisateur.
//
// Usage :
//   node migrate-base64-avatars.js           → simulation : affiche ce qui serait fait, ne modifie rien
//   node migrate-base64-avatars.js --apply   → applique la migration
//
// Sans risque à relancer : seuls les champs encore en base64 sont traités.

require('dotenv').config();
const mongoose = require('mongoose');
const { uploadImage } = require('./src/utils/uploadImage');

const APPLY = process.argv.includes('--apply');
const BASE64 = /^data:image\//i;

const publicId = (user) => (
  user.phone
    ? `user_${String(user.phone).replace(/\s+/g, '')}`
    : `user_${String(user.email || user._id).replace(/[^a-zA-Z0-9]/g, '_')}`
);

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ MongoDB connecté: ${mongoose.connection.host}`);
  console.log(APPLY ? '⚙️  Mode APPLICATION' : '🔍 Mode SIMULATION (ajoutez --apply pour appliquer)');

  const users = mongoose.connection.collection('users');
  const messages = mongoose.connection.collection('messages');

  const cursor = users.find({ avatar: { $regex: BASE64 } }, { projection: { _id: 1, name: 1, phone: 1, email: 1, avatar: 1 } });
  let migrated = 0;
  let failed = 0;
  let totalKb = 0;

  for await (const user of cursor) {
    const sizeKb = Math.round(user.avatar.length / 1024);
    totalKb += sizeKb;
    const msgCount = await messages.countDocuments({ senderId: user._id, senderAvatar: { $regex: BASE64 } });
    console.log(`• ${user.name || user._id} — photo ${sizeKb} Ko, ${msgCount} message(s) concerné(s)`);

    if (!APPLY) continue;

    try {
      const url = await uploadImage(user.avatar, 'kowa/avatars', publicId(user));
      await users.updateOne({ _id: user._id }, { $set: { avatar: url } });
      const res = await messages.updateMany(
        { senderId: user._id, senderAvatar: { $regex: BASE64 } },
        { $set: { senderAvatar: url } }
      );
      migrated += 1;
      console.log(`  ✅ → ${url} (${res.modifiedCount} message(s) mis à jour)`);
    } catch (error) {
      failed += 1;
      console.error(`  ❌ Échec : ${error.message}`);
    }
  }

  // Messages restants dont l'expéditeur n'a plus de photo base64 (ex. photo changée depuis)
  const orphanMessages = await messages.countDocuments({ senderAvatar: { $regex: BASE64 } });
  if (orphanMessages > 0) {
    console.log(`\n${orphanMessages} message(s) avec une ancienne photo base64 d'un profil déjà à jour.`);
    if (APPLY) {
      // La photo affichée vient du profil de l'interlocuteur : on retire simplement la copie inutile
      const res = await messages.updateMany({ senderAvatar: { $regex: BASE64 } }, { $set: { senderAvatar: null } });
      console.log(`🧹 ${res.modifiedCount} copie(s) retirée(s)`);
    }
  }

  console.log(`\nRésumé : ${Math.round(totalKb / 1024 * 10) / 10} Mo de photos en base64` +
    (APPLY ? ` — ${migrated} migrée(s), ${failed} échec(s)` : ' (rien n\'a été modifié)'));
};

run()
  .catch((err) => {
    console.error('❌ Migration échouée:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
