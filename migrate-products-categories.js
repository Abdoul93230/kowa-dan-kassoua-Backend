require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/models/Product');
const Category = require('./src/models/Category');

// Connexion à la base de données
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connecté');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
};

// Migration des produits
const migrateProducts = async () => {
  try {
    await connectDB();
    
    console.log('\n📦 Récupération des catégories...');
    const categories = await Category.find();
    
    if (categories.length === 0) {
      console.error('❌ Aucune catégorie trouvée !');
      console.log('⚠️  Exécutez d\'abord: node seed-categories.js');
      process.exit(1);
    }
    
    console.log(`✅ ${categories.length} catégories trouvées`);
    
    // Créer un map slug → ObjectId
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.slug] = cat._id;
      console.log(`   - ${cat.name} (${cat.slug})`);
    });
    
    console.log('\n🔍 Recherche des produits avec anciennes catégories...');
    
    // Utiliser directement la collection MongoDB pour éviter les problèmes de validation
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    // Trouver les produits où category est une string
    const products = await productsCollection.find({
      category: { $type: 'string' }
    }).toArray();
    
    if (products.length === 0) {
      console.log('✅ Aucun produit à migrer. Tous les produits sont déjà à jour !');
      process.exit(0);
    }
    
    console.log(`📋 ${products.length} produit(s) à migrer:\n`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const product of products) {
      const oldCategory = product.category;
      const newCategoryId = categoryMap[oldCategory];
      
      if (newCategoryId) {
        try {
          // Préparer les mises à jour
          const updateData = {
            category: newCategoryId,
            categorySlug: oldCategory
          };
          
          // Si subcategory existe, ajouter aussi son slug
          if (product.subcategory) {
            updateData.subcategorySlug = product.subcategory
              .toLowerCase()
              .trim()
              .replace(/\s+/g, '-');
          }
          
          // Mettre à jour directement dans MongoDB
          await productsCollection.updateOne(
            { _id: product._id },
            { $set: updateData }
          );
          
          console.log(`✅ "${product.title}"`);
          console.log(`   Catégorie: "${oldCategory}" → ObjectId(${newCategoryId})`);
          successCount++;
        } catch (error) {
          console.error(`❌ Erreur pour "${product.title}":`, error.message);
          errorCount++;
        }
      } else {
        console.warn(`⚠️  Catégorie "${oldCategory}" introuvable pour "${product.title}"`);
        console.log(`   → Ce produit ne sera pas migré`);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RÉSUMÉ DE LA MIGRATION:');
    console.log('='.repeat(60));
    console.log(`✅ Réussis: ${successCount}`);
    console.log(`❌ Échecs:  ${errorCount}`);
    console.log(`📦 Total:   ${products.length}`);
    console.log('='.repeat(60));
    
    if (successCount > 0) {
      console.log('\n🎉 Migration terminée avec succès !');
      console.log('👉 Vous pouvez maintenant démarrer votre application.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:', error);
    process.exit(1);
  }
};

// Exécuter la migration
migrateProducts();
