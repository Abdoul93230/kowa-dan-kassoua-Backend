require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const categories = await mongoose.connection.db.collection('categories').find({}).toArray();
  
  console.log('📋 Catégories, slugs et icônes:\n');
  categories.forEach(c => {
    console.log(`${c.name.padEnd(30)} slug: "${c.slug.padEnd(25)}" icon: "${c.icon || 'VIDE'}"`);
  });
  
  process.exit(0);
}).catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
