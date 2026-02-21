# 🎯 COMMANDES ESSENTIELLES - BACKEND

## 🚀 DÉMARRAGE RAPIDE

### Installation & Setup
```bash
cd backend
npm install
cp .env.example .env
# Configurer .env avec vos credentials MongoDB, Cloudinary, etc.
```

### Lancer le serveur
```bash
# Mode développement (auto-reload avec nodemon)
npm run dev

# Mode production
npm start
```

Le serveur démarre sur : `http://localhost:5000`

---

## 🧪 TESTS POSTMAN

### Health Check
```bash
GET http://localhost:5000/health
```

### Inscription
```bash
POST http://localhost:5000/api/auth/register
Content-Type: application/json

{
  "phone": "+22790123456",
  "password": "password123",
  "role": "buyer"
}
```

### Connexion
```bash
POST http://localhost:5000/api/auth/login
Content-Type: application/json

{
  "phone": "+22790123456",
  "password": "password123"
}
```
**⚠️ Copier le `token` retourné pour les requêtes suivantes**

### Tester une route protégée
```bash
GET http://localhost:5000/api/auth/me
Authorization: Bearer VOTRE_TOKEN_ICI
```

### Liste des produits
```bash
GET http://localhost:5000/api/products?category=electronics&page=1&limit=10
```

---

## 📦 GESTION NPM

### Installer un package
```bash
npm install nom-du-package

# Exemple :
npm install jest --save-dev
npm install winston
```

### Désinstaller un package
```bash
npm uninstall nom-du-package
```

### Voir packages installés
```bash
npm list --depth=0
```

---

## 🗄️ COMMANDES MONGODB

### Avec MongoDB Compass (GUI)
1. Ouvrir MongoDB Compass
2. Connecter à : `mongodb://localhost:27017`
3. Base de données : `kowa-dan-kassoua`

### Avec MongoDB Shell
```bash
# Se connecter
mongosh

# Utiliser la base
use kowa-dan-kassoua

# Lister collections
show collections

# Voir utilisateurs
db.users.find().pretty()

# Voir produits
db.products.find().pretty()

# Compter documents
db.users.countDocuments()

# Supprimer un utilisateur
db.users.deleteOne({ phone: "+22790123456" })

# Vider une collection (ATTENTION !)
db.users.deleteMany({})
```

---

## 🔧 COMMANDES GIT

### Créer une branche pour une phase
```bash
# Phase 1
git checkout -b feature/phase-1-users

# Travailler...
git add .
git commit -m "feat: implement user controller and routes"

# Fusionner dans main
git checkout main
git merge feature/phase-1-users
```

### Voir l'état
```bash
git status
git log --oneline -10
```

### Annuler des modifications
```bash
# Fichier spécifique
git checkout -- src/controllers/user.controller.js

# Tous les fichiers
git reset --hard
```

---

## 🐛 DEBUGGING

### Voir les logs en temps réel
```bash
npm run dev
# Les logs s'affichent dans le terminal
```

### Variables d'environnement
```bash
# Vérifier si .env est chargé
node -e "require('dotenv').config(); console.log(process.env.JWT_SECRET)"
```

### Tester une fonction isolée
```bash
# Créer test.js à la racine
node test.js
```

Exemple `test.js` :
```javascript
require('dotenv').config();
const connectDB = require('./src/config/database');

connectDB().then(() => {
  console.log('✅ MongoDB connecté');
  process.exit(0);
}).catch(err => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
```

---

## 📊 MONITORING

### Voir processus Node.js actifs
```bash
# Windows PowerShell
Get-Process node

# Tuer un processus
Stop-Process -Id PROCESS_ID
```

### Voir utilisation port
```bash
# Voir si port 5000 est utilisé
netstat -ano | findstr :5000
```

---

## 🧹 MAINTENANCE

### Nettoyer node_modules
```bash
rm -rf node_modules
npm install
```

### Mettre à jour packages
```bash
# Voir packages obsolètes
npm outdated

# Mettre à jour tous
npm update

# Mettre à jour un package spécifique
npm install express@latest
```

### Audit sécurité
```bash
npm audit
npm audit fix
```

---

## 📝 LOGS & DEBUGGING

### Activer logs détaillés MongoDB
Dans `.env` :
```env
NODE_ENV=development
DEBUG=mongoose:*
```

### Logs Morgan (HTTP)
Déjà activé avec `morgan('dev')` dans server.js

---

## 🔒 SÉCURITÉ

### Générer JWT Secret sécurisé
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Vérifier variables sensibles
```bash
# Liste variables .env
cat .env

# S'assurer que .env est dans .gitignore
cat .gitignore | grep .env
```

---

## 🚀 DÉPLOIEMENT

### Build pour production
```bash
# S'assurer que NODE_ENV=production
NODE_ENV=production npm start
```

### Variables d'environnement production
Sur Render/Railway/Heroku :
```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
JWT_SECRET=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
FRONTEND_URL=https://votresite.com
```

---

## 📚 RESSOURCES UTILES

### Documentation
- [Express.js](https://expressjs.com/)
- [Mongoose](https://mongoosejs.com/)
- [JWT](https://jwt.io/)
- [Socket.io](https://socket.io/docs/v4/)
- [Cloudinary Node.js](https://cloudinary.com/documentation/node_integration)

### Tutoriels
- [REST API Best Practices](https://stackoverflow.blog/2020/03/02/best-practices-for-rest-api-design/)
- [MongoDB Indexes](https://docs.mongodb.com/manual/indexes/)
- [Node.js Security](https://nodejs.org/en/docs/guides/security/)

---

## 🎯 WORKFLOW RECOMMANDÉ

### 1. Chaque matin
```bash
git pull origin main
npm install  # si package.json a changé
npm run dev
```

### 2. Développer une feature
```bash
git checkout -b feature/nom-feature
# Coder...
npm run dev  # tester
git add .
git commit -m "feat: description"
git push origin feature/nom-feature
```

### 3. Tester
- Postman : tester routes
- MongoDB Compass : vérifier données
- Console : vérifier logs

### 4. Merger
```bash
git checkout main
git merge feature/nom-feature
git push origin main
```

---

## ⚡ RACCOURCIS UTILES

### Redémarrer serveur rapidement
```bash
# Ctrl+C pour arrêter
# Puis
npm run dev
```

### Ouvrir plusieurs terminaux
Terminal 1 : Serveur backend
```bash
cd backend
npm run dev
```

Terminal 2 : Tests/MongoDB
```bash
mongosh
```

Terminal 3 : Git
```bash
git status
```

---

## 🆘 EN CAS DE PROBLÈME

### Erreur "Port already in use"
```bash
# Tuer processus sur port 5000
npx kill-port 5000

# Ou changer port dans .env
PORT=5001
```

### Erreur MongoDB "Connection refused"
```bash
# Vérifier que MongoDB est lancé
# Windows : Services → MongoDB Server → Démarrer
# Mac : brew services start mongodb-community
# Linux : sudo systemctl start mongod
```

### Erreur "Module not found"
```bash
npm install
```

### Serveur ne répond plus
```bash
# Ctrl+C puis
npm run dev
```

---

## 📞 SUPPORT

Pour toute question :
1. Vérifier [ANALYSE_BACKEND.md](./ANALYSE_BACKEND.md)
2. Consulter [PLAN_DE_TRAVAIL.md](./PLAN_DE_TRAVAIL.md)
3. Lire [PHASE_1_QUICK_START.md](./PHASE_1_QUICK_START.md)

---

**Bonne chance ! 🚀**

**Date** : 6 février 2026  
**Version** : 1.0
