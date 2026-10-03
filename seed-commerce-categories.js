/**
 * 🌱 Création des catégories & sous-catégories (commerces)
 * ------------------------------------------------------------------
 * Crée (ou met à jour) les catégories et leurs sous-catégories dans MongoDB.
 * Utilise la variable d'environnement MONGODB_URI du fichier .env.
 *
 * Lancement :
 *   node seed-commerce-categories.js
 *
 * Options (via variables d'environnement) :
 *   CATEGORY_ICON_FORMAT=emoji    → stocke un emoji (ex: "🏪")           [DÉFAUT]
 *   CATEGORY_ICON_FORMAT=lucide   → stocke le nom Lucide (ex: "Store")
 *   CATEGORY_HARD_RESET=true      → supprime TOUTES les catégories AVANT création
 *
 * ⚠️ Le script est idempotent : relancé, il met à jour les catégories existantes
 *    (même slug) au lieu de les dupliquer. Aucune donnée n'est supprimée par
 *    défaut (les produits existants ne sont donc pas impactés).
 *
 * 📝 Les `name` sont volontairement COURTS (affichage mobile). Le libellé complet
 *    est conservé dans `metaTitle` (catégories) et en commentaire (sous-catégories).
 *    Les doublons ont été fusionnés (ex : "Vendeur d'essence de rue" → "Essence",
 *    "Etal de Légumes & Condiments" → "Légumes").
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');

// ── Configuration ────────────────────────────────────────────────
const ICON_FORMAT = String(process.env.CATEGORY_ICON_FORMAT || 'emoji').toLowerCase(); // 'emoji' | 'lucide'
const HARD_RESET = String(process.env.CATEGORY_HARD_RESET || 'false').toLowerCase() === 'true';

// ── Utilitaires ──────────────────────────────────────────────────
// Transforme un libellé en slug URL (retire accents et caractères spéciaux)
const slugify = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ── Connexion MongoDB ────────────────────────────────────────────
const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI introuvable. Vérifie ton fichier .env');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connecté');
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB :', error.message);
    process.exit(1);
  }
};

// ── Données des catégories ───────────────────────────────────────
const categoriesData = [
  {
    name: 'Alimentation',
    slug: 'alimentation-produits-frais',
    metaTitle: 'Alimentation & Produits frais',
    description: 'Commerces alimentaires, produits frais et denrées de base',
    emoji: '🛒',
    lucideIcon: 'ShoppingBasket',
    color: 'bg-orange-100 text-orange-600',
    order: 1,
    subcategories: [
      { name: 'Épicerie', description: 'Épiceries et commerces alimentaires généraux', emoji: '🏪', lucideIcon: 'Store' }, // Alimentation générale
      { name: 'Légumes', description: 'Fruits, légumes frais et condiments', emoji: '🥕', lucideIcon: 'Carrot' }, // Légumes & Condiments
      { name: 'Céréales', description: 'Mil, sorgho, riz, haricots et autres céréales', emoji: '🌾', lucideIcon: 'Wheat' }, // Céréales & légumineuses
      { name: 'Boucherie', description: 'Viandes fraîches et grillades', emoji: '🥩', lucideIcon: 'Beef' }, // Boucherie & Grillades
      { name: 'Kilishi', description: 'Kilishi et viandes séchées épicées', emoji: '🍖', lucideIcon: 'Drumstick' }, // Vendeur de Kilishi
      { name: 'Poisson', description: 'Poissons frais', emoji: '🐟', lucideIcon: 'Fish' }, // Poissonnerie
      { name: 'Poisson fumé', description: 'Poissons fumés et séchés', emoji: '🔥', lucideIcon: 'Flame' }, // Vente de poisson fumé
      { name: 'Supermarché', description: 'Supermarchés et grandes surfaces', emoji: '🛒', lucideIcon: 'ShoppingCart' },
      { name: 'Autres', description: 'Autres commerces alimentaires', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Mode & Beauté',
    slug: 'habillement-beaute',
    metaTitle: 'Habillement & Beauté',
    description: 'Vêtements, tissus, cosmétiques et soins de beauté',
    emoji: '👗',
    lucideIcon: 'Shirt',
    color: 'bg-pink-100 text-pink-600',
    order: 2,
    subcategories: [
      { name: 'Tissus & Pagnes', description: 'Tissus, pagnes et couture', emoji: '🧵', lucideIcon: 'Layers' },
      { name: 'Friperie', description: "Vêtements d'occasion et fripes", emoji: '👕', lucideIcon: 'Shirt' },
      { name: 'Tailleur', description: 'Ateliers de couture et tailleurs', emoji: '📏', lucideIcon: 'Ruler' },
      { name: 'Cosmétiques', description: 'Produits cosmétiques et de soins', emoji: '💄', lucideIcon: 'Sparkles' },
      { name: 'Coiffure', description: 'Salons de coiffure et tresses', emoji: '💈', lucideIcon: 'Scissors' }, // Salon de coiffure
      { name: 'Autres', description: 'Autres commerces habillement et beauté', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Électronique',
    slug: 'telephonie-materiel-electronique',
    metaTitle: 'Téléphonie & Matériel électronique',
    description: 'Téléphonie, électronique, informatique et services numériques',
    emoji: '📱',
    lucideIcon: 'Smartphone',
    color: 'bg-blue-100 text-blue-600',
    order: 3,
    subcategories: [
      { name: 'Mobile Money', description: 'Transferts Mobile Money et recharges', emoji: '💳', lucideIcon: 'Wallet' }, // Mobile Money & Recharge
      { name: 'Réparation', description: 'Réparation téléphones et appareils', emoji: '🛠️', lucideIcon: 'Wrench' }, // Atelier de réparation électronique
      { name: 'Électronique & Info', description: 'Téléphones, ordinateurs et accessoires', emoji: '💻', lucideIcon: 'Laptop' }, // Vente de matériel électronique & Informatique
      { name: 'Photo & Impression', description: 'Photographie et impression rapide', emoji: '📷', lucideIcon: 'Camera' }, // Studio photo & Impression rapide
      { name: 'Wifi', description: 'Zones et services Wifi', emoji: '📶', lucideIcon: 'Wifi' } // Hotspot Wifi
    ]
  },
  {
    name: 'Transport',
    slug: 'transport-mecanique-energie',
    metaTitle: 'Transport, Mécanique & Énergie',
    description: 'Carburant, mécanique automobile et énergie',
    emoji: '🚗',
    lucideIcon: 'Car',
    color: 'bg-red-100 text-red-600',
    order: 4,
    subcategories: [
      { name: 'Station-service', description: 'Stations-service et carburant', emoji: '⛽', lucideIcon: 'Fuel' },
      { name: 'Motos', description: 'Réparation motos et deux-roues', emoji: '🏍️', lucideIcon: 'Bike' }, // Réparateur motos & Deux-roues
      { name: 'Mécanique auto', description: 'Garages, mécanique et tôlerie', emoji: '🔧', lucideIcon: 'Wrench' }, // Mécanique automobile & Tôlerie
      { name: 'Solaire & Batteries', description: 'Énergie solaire et batteries', emoji: '🔋', lucideIcon: 'BatteryCharging' }, // Panneaux solaires & Batteries
      { name: 'Gaz', description: 'Dépôts et vente de gaz domestique', emoji: '🔥', lucideIcon: 'Flame' }, // Dépôt de gaz domestique
      { name: 'Autres', description: 'Autres commerces transport et énergie', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Maison',
    slug: 'maison-bricolage',
    metaTitle: 'Maison & Bricolage',
    description: 'Quincaillerie, menuiserie et ameublement',
    emoji: '🔨',
    lucideIcon: 'Hammer',
    color: 'bg-amber-100 text-amber-600',
    order: 5,
    subcategories: [
      { name: 'Quincaillerie', description: 'Quincailleries et outils', emoji: '🔨', lucideIcon: 'Hammer' },
      { name: 'Menuiserie', description: 'Ateliers de menuiserie', emoji: '🪚', lucideIcon: 'Ruler' },
      { name: 'Ameublement', description: 'Meubles et ameublement', emoji: '🛋️', lucideIcon: 'Armchair' },
      { name: 'Autres', description: 'Autres commerces maison et bricolage', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Agro & Élevage',
    slug: "produits-agricoles-d-elevage",
    metaTitle: "Produits agricoles & d'élevage",
    description: "Intrants, aliments pour bétail et produits de l'élevage",
    emoji: '🌾',
    lucideIcon: 'Wheat',
    color: 'bg-lime-100 text-lime-600',
    order: 6,
    subcategories: [
      { name: 'Bétail', description: 'Marchés à bétail et animaux', emoji: '🐄', lucideIcon: 'Beef' }, // Marché à bétail
      { name: 'Aliments bétail', description: 'Fourrage et aliments pour bétail', emoji: '🌾', lucideIcon: 'Wheat' }, // Vente d'aliments pour bétail
      { name: 'Intrants & Outils', description: 'Semences, engrais et outillage agricole', emoji: '🌱', lucideIcon: 'Sprout' }, // Intrants agricoles & Outillage
      { name: 'Autres', description: 'Autres produits agricoles et élevage', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Santé & Loisirs',
    slug: 'sante-education-loisirs',
    metaTitle: 'Santé, Éducation & Loisirs',
    description: 'Pharmacies, librairies et loisirs',
    emoji: '⚕️',
    lucideIcon: 'Stethoscope',
    color: 'bg-emerald-100 text-emerald-600',
    order: 7,
    subcategories: [
      { name: 'Pharmacie', description: 'Pharmacies et dépôts pharmaceutiques', emoji: '💊', lucideIcon: 'Pill' }, // Pharmacie & Dépôt pharmaceutique
      { name: 'Pharmacopée', description: 'Médecine et produits traditionnels', emoji: '🌿', lucideIcon: 'Leaf' }, // Pharmacopée traditionnelle
      { name: 'Librairie', description: 'Librairies et papeteries', emoji: '📚', lucideIcon: 'BookOpen' }, // Librairie & Papeterie
      { name: 'Jeux', description: 'Salles de jeux et divertissement', emoji: '🎮', lucideIcon: 'Gamepad2' }, // Salle de jeux
      { name: 'Autres', description: 'Autres commerces santé, éducation et loisirs', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Proximité',
    slug: 'petits-commerces',
    metaTitle: 'Petits commerces',
    description: 'Petits commerces, restauration de rue et services de proximité',
    emoji: '🏪',
    lucideIcon: 'Store',
    color: 'bg-violet-100 text-violet-600',
    order: 8,
    subcategories: [
      { name: 'Essence', description: "Vente d'essence et carburant de détail", emoji: '⛽', lucideIcon: 'Fuel' }, // Vendeur d'essence (+ de rue fusionnés)
      { name: 'Restauration', description: 'Restauration rapide et de rue', emoji: '🍢', lucideIcon: 'UtensilsCrossed' }, // Restauration de rue
      { name: 'Kiosque à thé', description: 'Kiosques à thé et cafés populaires', emoji: '☕', lucideIcon: 'Coffee' }, // Kiosque à thé / "Fada" café
      { name: 'Eau & Jus', description: "Vente d'eau et de jus locaux", emoji: '🥤', lucideIcon: 'GlassWater' }, // Vendeur d'eau & Jus locaux
      { name: 'Pressing', description: 'Blanchisserie et pressing', emoji: '🧺', lucideIcon: 'WashingMachine' }, // Blanchisserie / Pressing
      { name: 'Taxi', description: 'Services de taxi', emoji: '🚕', lucideIcon: 'CarTaxiFront' },
      { name: 'Taxi-moto', description: 'Transport par taxi-moto', emoji: '🛵', lucideIcon: 'Bike' },
      { name: 'Tresseuse', description: 'Tresses et coiffure à domicile', emoji: '💇', lucideIcon: 'Scissors' },
      { name: 'Autres', description: 'Autres petits commerces', emoji: '➕', lucideIcon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Immobilier',
    slug: 'immobilier',
    metaTitle: 'Immobilier',
    description: 'Location, vente et services immobiliers',
    emoji: '🏠',
    lucideIcon: 'Building2',
    color: 'bg-green-100 text-green-600',
    order: 9,
    subcategories: [
      { name: 'Locations', description: 'Locations de logements et de locaux', emoji: '🔑', lucideIcon: 'KeyRound' },
      { name: 'Vente maisons', description: 'Vente de maisons', emoji: '🏠', lucideIcon: 'Home' },
      { name: 'Parcelles', description: 'Vente de parcelles et terrains', emoji: '🗺️', lucideIcon: 'Map' }, // Vente Parcelles
      { name: 'Démarcheur', description: 'Agents et démarcheurs immobiliers', emoji: '🤝', lucideIcon: 'UserCheck' } // Démarcheur Immobilier
    ]
  },
  {
    name: 'Services Pro',
    slug: 'prestation-intellectuelle',
    metaTitle: 'Prestation intellectuelle',
    description: 'Services intellectuels, conseils et ingénierie',
    emoji: '💼',
    lucideIcon: 'Briefcase',
    color: 'bg-indigo-100 text-indigo-600',
    order: 10,
    subcategories: [
      { name: 'BTP', description: 'Bâtiment et travaux publics', emoji: '🏗️', lucideIcon: 'HardHat' },
      { name: 'Conseil', description: 'Conseil et expertise', emoji: '💡', lucideIcon: 'Lightbulb' }, // Conseils & Expertise
      { name: 'Informatique', description: 'Services informatiques', emoji: '🖥️', lucideIcon: 'MonitorSmartphone' }, // Cabinet Informtique
      { name: 'Finances', description: 'Services financiers', emoji: '💰', lucideIcon: 'Banknote' },
      { name: 'Ingénierie', description: "Autres services d'ingénierie", emoji: '⚙️', lucideIcon: 'Cog' } // Autres services d'ingénierie
    ]
  },
  {
    name: 'Livraison',
    slug: 'livraison',
    metaTitle: 'Livraison',
    description: 'Livraison à moto et en voiture',
    emoji: '🚚',
    lucideIcon: 'Truck',
    color: 'bg-cyan-100 text-cyan-600',
    order: 11,
    subcategories: [
      { name: 'Livreur moto', description: 'Livraison à moto', emoji: '🛵', lucideIcon: 'Bike' }, // Livreur à moto
      { name: 'Livreur voiture', description: 'Livraison en voiture', emoji: '🚚', lucideIcon: 'Truck' } // Livreur en voiture
    ]
  }
];

// ── Construction du document catégorie ───────────────────────────
const pickIcon = (emoji, lucideIcon) => (ICON_FORMAT === 'lucide' ? lucideIcon : emoji);

const buildCategoryPayload = (cat) => ({
  name: cat.name,
  slug: cat.slug || slugify(cat.name),
  description: cat.description || '',
  icon: pickIcon(cat.emoji, cat.lucideIcon),
  color: cat.color || 'bg-gray-100 text-gray-600',
  order: typeof cat.order === 'number' ? cat.order : 0,
  active: true,
  metaTitle: cat.metaTitle || cat.name,
  metaDescription: cat.description || '',
  subcategories: (cat.subcategories || []).map((sub) => ({
    name: sub.name,
    slug: sub.slug || slugify(sub.name),
    description: sub.description || '',
    icon: pickIcon(sub.emoji, sub.lucideIcon),
    active: true
  }))
});

// ── Création / mise à jour des catégories ────────────────────────
const seedCategories = async () => {
  try {
    await connectDB();

    if (HARD_RESET) {
      console.log('🗑️  HARD_RESET activé → suppression de toutes les catégories...');
      await Category.deleteMany({});
    }

    const stats = { created: 0, updated: 0, failed: 0 };

    for (const cat of categoriesData) {
      const payload = buildCategoryPayload(cat);
      try {
        const existing = await Category.findOne({ slug: payload.slug });

        await Category.findOneAndUpdate(
          { slug: payload.slug },
          { $set: payload },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );

        if (existing) {
          stats.updated++;
          console.log(`♻️  Mise à jour : ${cat.name.padEnd(38)} (${payload.subcategories.length} sous-catégories)`);
        } else {
          stats.created++;
          console.log(`✅ Créée       : ${cat.name.padEnd(38)} (${payload.subcategories.length} sous-catégories)`);
        }
      } catch (err) {
        stats.failed++;
        console.error(`❌ Échec       : ${cat.name} → ${err.message}`);
      }
    }

    console.log('\n' + '='.repeat(72));
    console.log(`🎯 Terminé → créées: ${stats.created} | mises à jour: ${stats.updated} | échecs: ${stats.failed}`);
    console.log(`🎨 Format des icônes : ${ICON_FORMAT}`);
    console.log('='.repeat(72));

    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors du seeding :', error);
    process.exit(1);
  }
};

seedCategories();
