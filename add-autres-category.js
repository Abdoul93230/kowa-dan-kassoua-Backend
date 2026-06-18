require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connecté');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error);
    process.exit(1);
  }
};

const addAutresCategory = async () => {
  try {
    await connectDB();

    // 1. Ajouter sous-catégorie "Autres" à chaque catégorie qui n'en a pas
    const allCategories = await Category.find({ active: true });
    let subcatAdded = 0;

    for (const cat of allCategories) {
      const hasAutres = cat.subcategories.some(sub => sub.slug === 'autres');
      if (!hasAutres) {
        cat.subcategories.push({
          name: 'Autres',
          slug: 'autres',
          description: 'Autres éléments de cette catégorie',
          icon: 'MoreHorizontal',
          active: true
        });
        await cat.save();
        console.log(`  ✔ Sous-catégorie "Autres" ajoutée à: ${cat.name}`);
        subcatAdded++;
      } else {
        console.log(`  ⏭ "${cat.name}" a déjà une sous-catégorie "Autres"`);
      }
    }

    // 2. Créer la catégorie principale "Autres" si elle n'existe pas
    const existingAutres = await Category.findOne({ slug: 'autres' });
    if (!existingAutres) {
      await Category.create({
        name: 'Autres',
        slug: 'autres',
        description: 'Annonces et services ne correspondant pas aux autres catégories',
        icon: 'MoreHorizontal',
        color: 'bg-gray-100 text-gray-600',
        order: 99,
        subcategories: [],
        active: true
      });
      console.log('✅ Catégorie principale "Autres" créée (order: 99)');
    } else {
      console.log('⏭ Catégorie principale "Autres" existe déjà');
    }

    console.log(`\n✅ Migration terminée: ${subcatAdded} sous-catégorie(s) ajoutée(s)`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur migration:', error);
    process.exit(1);
  }
};

addAutresCategory();
