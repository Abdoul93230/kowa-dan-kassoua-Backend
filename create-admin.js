// Crée le PREMIER administrateur (les suivants s'ajoutent depuis le site : /admin/equipe).
// Un mot de passe temporaire est envoyé à l'adresse indiquée ; il n'est jamais affiché ici.
// À la première connexion, l'administrateur choisit son propre mot de passe.
//
// Usage :
//   node create-admin.js admin@exemple.com "Nom Prénom"
// Si un compte existe déjà avec cet e-mail, il devient administrateur (nouveau mot de passe envoyé).

require('dotenv').config();
const mongoose = require('mongoose');
const { createAdmin } = require('./src/services/adminAccounts');

const [email, ...nameParts] = process.argv.slice(2);

async function run() {
  if (!email) throw new Error('Usage : node create-admin.js admin@exemple.com "Nom Prénom"');
  await mongoose.connect(process.env.MONGODB_URI);
  const { user, promoted } = await createAdmin({ email, name: nameParts.join(' ') });
  console.log(promoted
    ? `✅ ${user.email} est maintenant administrateur. Ses accès lui ont été envoyés par e-mail.`
    : `✅ Administrateur créé : ${user.email}. Ses accès lui ont été envoyés par e-mail.`);
}

run()
  .catch((error) => { console.error('❌', error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
