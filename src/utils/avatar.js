// Photos de profil : seules les URL d'images (Cloudinary) sont envoyées aux clients.
// D'anciens comptes ont leur photo enregistrée en base64 directement dans la base
// (« data:image/...;base64,… », plusieurs centaines de Ko) : recopiée dans chaque carte
// d'annonce et chaque message, elle alourdissait les réponses jusqu'à plusieurs Mo.
// Ces profils affichent leurs initiales en attendant la migration
// (scripts/migrate-base64-avatars.js).

const publicAvatar = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
};

module.exports = { publicAvatar };
