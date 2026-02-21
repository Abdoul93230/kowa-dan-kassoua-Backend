// 🧪 Script de test rapide des modèles
const mongoose = require('mongoose');
const models = require('./models');

async function testModels() {
  try {
    console.log('🔍 Test des modèles...\n');
    
    // Test 1: Vérifier que tous les modèles sont chargés
    console.log('✅ User:', models.User.modelName);
    console.log('✅ Product:', models.Product.modelName);
    console.log('✅ Review:', models.Review.modelName);
    console.log('✅ Conversation:', models.Conversation.modelName);
    console.log('✅ Message:', models.Message.modelName);
    
    // Test 2: Vérifier les schémas
    console.log('\n📋 Vérification des schémas:');
    console.log('User fields:', Object.keys(models.User.schema.paths).length, 'champs');
    console.log('Product fields:', Object.keys(models.Product.schema.paths).length, 'champs');
    console.log('Review fields:', Object.keys(models.Review.schema.paths).length, 'champs');
    console.log('Conversation fields:', Object.keys(models.Conversation.schema.paths).length, 'champs');
    console.log('Message fields:', Object.keys(models.Message.schema.paths).length, 'champs');
    
    // Test 3: Vérifier les méthodes essentielles
    console.log('\n🔧 Vérification des méthodes:');
    console.log('User.comparePassword:', typeof models.User.schema.methods.comparePassword);
    console.log('User.toSellerJSON:', typeof models.User.schema.methods.toSellerJSON);
    console.log('Product.toItemJSON:', typeof models.Product.schema.methods.toItemJSON);
    console.log('Review.toReviewJSON:', typeof models.Review.schema.methods.toReviewJSON);
    console.log('Conversation.toConversationJSON:', typeof models.Conversation.schema.methods.toConversationJSON);
    console.log('Message.toMessageJSON:', typeof models.Message.schema.methods.toMessageJSON);
    
    console.log('\n✅ Tous les modèles sont valides!\n');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

testModels();
