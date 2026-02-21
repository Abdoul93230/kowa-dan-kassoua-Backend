# Backend API - Kowa Dan Kassoua

API REST Node.js + Express + MongoDB pour la plateforme Kowa Dan Kassoua.

## 🚀 Installation

```bash
npm install
```

## 📝 Configuration

Copiez le fichier `.env.example` vers `.env` et configurez les variables :

```bash
cp .env.example .env
```

Variables importantes :
- `MONGODB_URI` : URI de connexion MongoDB
- `JWT_SECRET` : Clé secrète JWT
- `CLOUDINARY_*` : Credentials Cloudinary
- `GOOGLE_VISION_API_KEY` : Clé API Google Vision

## 🏃 Démarrage

```bash
# Mode développement (avec nodemon)
npm run dev

# Mode production
npm start
```

## 📁 Structure

```
backend/
├── src/
│   ├── server.js           # Point d'entrée
│   ├── config/
│   │   ├── database.js     # Connexion MongoDB
│   │   └── cloudinary.js   # Config Cloudinary
│   ├── models/             # Modèles Mongoose
│   │   ├── User.js
│   │   ├── Product.js
│   │   ├── Order.js
│   │   ├── Message.js
│   │   └── Review.js
│   ├── controllers/        # Logique métier
│   │   ├── auth.controller.js
│   │   ├── product.controller.js
│   │   └── ...
│   ├── routes/             # Routes API
│   │   ├── auth.routes.js
│   │   ├── product.routes.js
│   │   └── ...
│   ├── middleware/         # Middleware custom
│   │   ├── auth.js
│   │   └── errorHandler.js
│   └── utils/              # Utilitaires
│       ├── sms.js
│       ├── ocr.js
│       └── ...
└── package.json
```

## 🔌 Routes API

### Authentification
- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `POST /api/auth/send-otp` - Envoyer OTP
- `POST /api/auth/verify-otp` - Vérifier OTP
- `POST /api/auth/refresh` - Rafraîchir token
- `GET /api/auth/me` - Utilisateur connecté

### Produits
- `GET /api/products` - Liste produits (avec filtres)
- `GET /api/products/nearby` - Produits à proximité
- `GET /api/products/:id` - Détails produit
- `POST /api/products` - Créer produit (Seller)
- `PUT /api/products/:id` - Modifier produit
- `DELETE /api/products/:id` - Supprimer produit

### Commandes
- `GET /api/orders` - Mes commandes
- `POST /api/orders` - Créer commande
- `GET /api/orders/:id` - Détails commande

### Messages
- `GET /api/messages` - Mes conversations
- `POST /api/messages` - Envoyer message

### Avis
- `POST /api/reviews` - Laisser un avis
- `GET /api/reviews/:targetId` - Avis d'un produit/vendeur

## 🔒 Authentification

L'API utilise JWT pour l'authentification. Incluez le token dans les headers :

```
Authorization: Bearer <token>
```

## 🌐 URLs

- Développement: http://localhost:5000
- Production: À définir
