require('dotenv').config();
const cloudinary = require('./src/config/cloudinary');

console.log('=== TEST CLOUDINARY CONFIGURATION ===\n');

console.log('1. Variables d\'environnement:');
console.log('   CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('   CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY ? '✅ Défini' : '❌ Non défini');
console.log('   CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? '✅ Défini' : '❌ Non défini');

console.log('\n2. Configuration Cloudinary:');
const config = cloudinary.config();
console.log('   Cloud Name:', config.cloud_name);
console.log('   API Key:', config.api_key ? '✅ Configuré' : '❌ Non configuré');
console.log('   API Secret:', config.api_secret ? '✅ Configuré' : '❌ Non configuré');

console.log('\n3. Test d\'upload (image de test base64):');
const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

cloudinary.uploader.upload(testBase64, {
  folder: 'test',
  public_id: 'test_image_' + Date.now()
})
.then(result => {
  console.log('   ✅ Upload réussi!');
  console.log('   URL:', result.secure_url);
  console.log('\n=== CLOUDINARY FONCTIONNE CORRECTEMENT ===');
  
  // Nettoyer l'image de test
  return cloudinary.uploader.destroy(`test/${result.public_id}`);
})
.then(() => {
  console.log('   ✅ Image de test supprimée');
  process.exit(0);
})
.catch(error => {
  console.error('   ❌ Erreur:', error.message);
  console.log('\n=== PROBLÈME AVEC CLOUDINARY ===');
  process.exit(1);
});
