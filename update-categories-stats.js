require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');
const Product = require('./src/models/Product'); // Nécessaire pour updateStats()

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

// Mettre à jour les statistiques de toutes les catégories
const updateAllCategoriesStats = async () => {
  try {
    await connectDB();
    
    console.log('🔄 Mise à jour des statistiques de toutes les catégories...\n');
    
    const categories = await Category.find();
    
    if (categories.length === 0) {
      console.log('⚠️  Aucune catégorie trouvée');
      process.exit(0);
    }
    
    console.log(`📊 ${categories.length} catégories trouvées\n`);
    
    for (const category of categories) {
      await category.updateStats();
      console.log(`✅ ${category.name.padEnd(30)} → ${category.productsCount} produits, ${category.servicesCount} services`);
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✨ Toutes les statistiques ont été mises à jour avec succès !');
    console.log('='.repeat(70));
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erreur lors de la mise à jour des stats:', error);
    process.exit(1);
  }
};

// Exécuter
updateAllCategoriesStats();
