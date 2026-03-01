require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');

// Map des icônes emoji pour chaque catégorie
const categoryEmojis = {
  'electronique': '📱',
  'alimentation': '🍔',
  'immobilier': '🏠',
  'vehicules': '🚗',
  'mode': '👕',
  'services': '🔧',
  'maison': '🏡',
  'emploi': '💼',
  'loisirs': '🎮',
  'materiaux': '🏗️'
};

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connecté');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
};

const addEmojis = async () => {
  try {
    await connectDB();
    
    console.log('🎨 Ajout des emojis aux catégories...\n');
    
    const categories = await Category.find();
    
    let updated = 0;
    
    for (const category of categories) {
      const emoji = categoryEmojis[category.slug];
      
      if (emoji) {
        // Sauvegarder l'icône Lucide actuelle dans un champ séparé si besoin
        category.lucideIcon = category.icon;
        // Remplacer par l'emoji
        category.icon = emoji;
        await category.save();
        
        console.log(`✅ ${category.name.padEnd(30)} → ${emoji}`);
        updated++;
      } else {
        console.log(`⚠️  ${category.name.padEnd(30)} → Pas d'emoji défini`);
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log(`✨ ${updated} catégories mises à jour avec des emojis !`);
    console.log('='.repeat(70));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
};

addEmojis();
