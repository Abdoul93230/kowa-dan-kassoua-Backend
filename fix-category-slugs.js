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

// Corriger les categorySlug manquants
const fixCategorySlugs = async () => {
  try {
    await connectDB();
    
    console.log('🔍 Recherche des produits sans categorySlug...\n');
    
    // Trouver les produits qui ont category mais pas de categorySlug
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    const products = await productsCollection.find({
      category: { $exists: true },
      $or: [
        { categorySlug: { $exists: false } },
        { categorySlug: null },
        { categorySlug: '' }
      ]
    }).toArray();
    
    if (products.length === 0) {
      console.log('✅ Tous les produits ont déjà un categorySlug !');
      process.exit(0);
    }
    
    console.log(`📋 ${products.length} produit(s) à corriger:\n`);
    
    // Charger toutes les catégories
    const categories = await Category.find();
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat._id.toString()] = cat.slug;
    });
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const product of products) {
      try {
        const categoryId = product.category.toString();
        const categorySlug = categoryMap[categoryId];
        
        if (categorySlug) {
          // Préparer les mises à jour
          const updateData = {
            categorySlug: categorySlug
          };
          
          // Si subcategory existe mais pas de subcategorySlug
          if (product.subcategory && !product.subcategorySlug) {
            updateData.subcategorySlug = product.subcategory
              .toLowerCase()
              .trim()
              .replace(/\s+/g, '-');
          }
          
          // Mettre à jour
          await productsCollection.updateOne(
            { _id: product._id },
            { $set: updateData }
          );
          
          console.log(`✅ "${product.title}"`);
          console.log(`   categorySlug: "${categorySlug}"`);
          successCount++;
        } else {
          console.warn(`⚠️  Catégorie introuvable pour "${product.title}" (ID: ${categoryId})`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Erreur pour "${product.title}":`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log(`✅ Réussis: ${successCount}, ❌ Échecs: ${errorCount}`);
    console.log('='.repeat(70));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
};

fixCategorySlugs();
