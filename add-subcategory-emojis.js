require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');

// Map des emojis pour les sous-catégories fréquentes
const subcategoryEmojis = {
  // Électronique
  'smartphones': '📱',
  'ordinateurs': '💻',
  'tablettes': '📱',
  'tv-audio': '📺',
  'accessoires': '🔌',
  'photo-video': '📷',
  'jeux-video': '🎮',
  
  // Alimentation
  'fruits-legumes': '🥕',
  'viande-poisson': '🍖',
  'produits-laitiers': '🥛',
  'pain-patisserie': '🍞',
  'epicerie': '🏪',
  'boissons': '🥤',
  
  // Immobilier
  'appartements': '🏢',
  'maisons': '🏠',
  'terrains': '🏞️',
  'commerces': '🏪',
  'bureaux': '🏢',
  
  // Véhicules
  'voitures': '🚗',
  'motos': '🏍️',
  'camions': '🚚',
  'pieces-auto': '⚙️',
  'accessoires-auto': '🔧',
  
  // Mode
  'vetements-homme': '👔',
  'vetements-femme': '👗',
  'chaussures': '👟',
  'sacs': '👜',
  'montres': '⌚',
  'bijoux': '💍',
  
  // Services
  'reparation': '🔧',
  'nettoyage': '🧹',
  'transport': '🚚',
  'education': '📚',
  'sante': '⚕️',
  'evenements': '🎉',
  
  // Maison & Jardin
  'meubles': '🛋️',
  'decoration': '🖼️',
  'electromenager': '🔌',
  'jardinage': '🌱',
  'bricolage': '🔨',
  
  // Emploi
  'offres': '💼',
  'demandes': '🔍',
  'stages': '🎓',
  
  // Loisirs
  'sports': '⚽',
  'musique': '🎵',
  'livres': '📚',
  'jouets': '🧸',
  
  // Matériaux
  'construction': '🏗️',
  'electricite': '⚡',
  'plomberie': '🚰',
  'peinture': '🎨',
  'menuiserie': '🪚'
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

const addSubcategoryEmojis = async () => {
  try {
    await connectDB();
    
    console.log('🎨 Ajout des emojis aux sous-catégories...\n');
    
    const categories = await Category.find();
    
    let updated = 0;
    let total = 0;
    
    for (const category of categories) {
      console.log(`\n📂 ${category.name}:`);
      
      if (category.subcategories && category.subcategories.length > 0) {
        for (const sub of category.subcategories) {
          total++;
          const emoji = subcategoryEmojis[sub.slug];
          
          if (emoji) {
            sub.icon = emoji;
            updated++;
            console.log(`  ✅ ${sub.name.padEnd(25)} → ${emoji}`);
          } else {
            // Emoji par défaut si non trouvé
            sub.icon = '📄';
            console.log(`  ⚠️  ${sub.name.padEnd(25)} → 📄 (emoji par défaut)`);
          }
        }
        
        await category.save();
      } else {
        console.log(`  ℹ️  Pas de sous-catégories`);
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log(`✨ ${updated}/${total} sous-catégories avec emojis personnalisés !`);
    console.log(`📄 ${total - updated} sous-catégories avec emoji par défaut`);
    console.log('='.repeat(70));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
};

addSubcategoryEmojis();
