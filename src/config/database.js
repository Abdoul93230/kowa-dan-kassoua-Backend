const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Connexions réutilisées entre les requêtes (les requêtes parallèles de l'accueil en profitent)
      maxPoolSize: Number(process.env.MONGODB_POOL_SIZE) || 30,
      minPoolSize: 2,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
