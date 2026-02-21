require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/models/Product');
const { uploadImage } = require('./src/utils/uploadImage');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kowa-dan-kassoua';

async function migrateImagesToCloudinary() {
  try {
    console.log('🔄 Connexion à MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Trouver tous les produits qui ont des images en base64
    const products = await Product.find({});
    
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    console.log(`📦 ${products.length} produits trouvés\n`);

    for (const product of products) {
      console.log(`\n📝 Produit: ${product.title} (${product._id})`);
      
      // Vérifier si les images sont en base64 (commencent par "data:")
      const hasBase64Images = product.images.some(img => img.startsWith('data:'));
      
      if (!hasBase64Images) {
        console.log('   ⏭️  Images déjà sur Cloudinary');
        skippedCount++;
        continue;
      }

      try {
        console.log(`   🔄 Migration de ${product.images.length} images...`);
        
        // Upload les images base64 sur Cloudinary
        const newImages = [];
        for (let i = 0; i < product.images.length; i++) {
          const image = product.images[i];
          
          if (image.startsWith('data:')) {
            console.log(`   📤 Upload image ${i + 1}/${product.images.length}...`);
            const cloudinaryUrl = await uploadImage(
              image,
              'products',
              `product_${product.seller}_${product._id}_${i}`
            );
            newImages.push(cloudinaryUrl);
            console.log(`   ✅ Uploadé: ${cloudinaryUrl.substring(0, 60)}...`);
          } else {
            // Garder les URLs existantes
            newImages.push(image);
          }
        }

        // Mettre à jour le produit
        product.images = newImages;
        product.mainImage = newImages[0];
        await product.save();

        console.log('   ✅ Produit migré avec succès');
        migratedCount++;

      } catch (error) {
        console.error('   ❌ Erreur:', error.message);
        errorCount++;
      }
    }

    console.log('\n\n=== RÉSUMÉ DE LA MIGRATION ===');
    console.log(`✅ Produits migrés: ${migratedCount}`);
    console.log(`⏭️  Produits ignorés (déjà migrés): ${skippedCount}`);
    console.log(`❌ Erreurs: ${errorCount}`);
    console.log(`📊 Total: ${products.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Déconnexion de MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  }
}

console.log('🚀 MIGRATION DES IMAGES VERS CLOUDINARY\n');
console.log('Ce script va:');
console.log('1. Trouver tous les produits avec des images en base64');
console.log('2. Uploader ces images sur Cloudinary');
console.log('3. Mettre à jour la base de données avec les URLs Cloudinary\n');

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.question('Continuer ? (oui/non): ', (answer) => {
  readline.close();
  if (answer.toLowerCase() === 'oui' || answer.toLowerCase() === 'o') {
    migrateImagesToCloudinary();
  } else {
    console.log('❌ Migration annulée');
    process.exit(0);
  }
});
