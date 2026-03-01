require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');

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

// Données des catégories
const categoriesData = [
  {
    name: 'Électronique',
    slug: 'electronique',
    description: 'Smartphones, ordinateurs, accessoires et services informatiques',
    icon: 'Smartphone',
    color: 'bg-blue-100 text-blue-600',
    order: 1,
    subcategories: [
      { name: 'Téléphones', slug: 'telephones', description: 'Smartphones et téléphones mobiles', icon: 'Smartphone' },
      { name: 'Ordinateurs', slug: 'ordinateurs', description: 'PC portables et de bureau', icon: 'Laptop' },
      { name: 'Tablettes', slug: 'tablettes', description: 'Tablettes tactiles', icon: 'Tablet' },
      { name: 'Accessoires', slug: 'accessoires', description: 'Écouteurs, chargeurs, coques...', icon: 'Headphones' },
      { name: 'Services IT', slug: 'services-it', description: 'Réparation, maintenance informatique', icon: 'Wrench' }
    ]
  },
  {
    name: 'Alimentation',
    slug: 'alimentation',
    description: 'Produits alimentaires, restaurants et services traiteur',
    icon: 'UtensilsCrossed',
    color: 'bg-orange-100 text-orange-600',
    order: 2,
    subcategories: [
      { name: 'Restaurants', slug: 'restaurants', description: 'Restaurants et fast-food', icon: 'UtensilsCrossed' },
      { name: 'Produits frais', slug: 'produits-frais', description: 'Fruits, légumes, viandes', icon: 'Apple' },
      { name: 'Traiteur', slug: 'traiteur', description: 'Services traiteur événements', icon: 'ChefHat' },
      { name: 'Pâtisserie', slug: 'patisserie', description: 'Gâteaux et pâtisseries', icon: 'Cake' },
      { name: 'Épicerie', slug: 'epicerie', description: 'Produits alimentaires divers', icon: 'ShoppingBasket' }
    ]
  },
  {
    name: 'Immobilier',
    slug: 'immobilier',
    description: 'Vente, location et services immobiliers',
    icon: 'Home',
    color: 'bg-green-100 text-green-600',
    order: 3,
    subcategories: [
      { name: 'Location appartements', slug: 'location-appartements', description: 'Appartements à louer', icon: 'Building' },
      { name: 'Vente maisons', slug: 'vente-maisons', description: 'Maisons à vendre', icon: 'Home' },
      { name: 'Terrains', slug: 'terrains', description: 'Terrains à vendre', icon: 'Trees' },
      { name: 'Bureaux', slug: 'bureaux', description: 'Locaux commerciaux et bureaux', icon: 'Building2' },
      { name: 'Services', slug: 'services', description: 'Agents immobiliers, notaires', icon: 'Briefcase' }
    ]
  },
  {
    name: 'Véhicules',
    slug: 'vehicules',
    description: 'Voitures, motos, pièces détachées et services automobiles',
    icon: 'Car',
    color: 'bg-red-100 text-red-600',
    order: 4,
    subcategories: [
      { name: 'Voitures', slug: 'voitures', description: 'Voitures d\'occasion et neuves', icon: 'Car' },
      { name: 'Motos', slug: 'motos', description: 'Motos et scooters', icon: 'Bike' },
      { name: 'Pièces détachées', slug: 'pieces', description: 'Pièces auto et moto', icon: 'Settings' },
      { name: 'Services auto', slug: 'services-auto', description: 'Garages, réparation', icon: 'Wrench' }
    ]
  },
  {
    name: 'Mode & Beauté',
    slug: 'mode',
    description: 'Vêtements, accessoires et services de beauté',
    icon: 'Shirt',
    color: 'bg-pink-100 text-pink-600',
    order: 5,
    subcategories: [
      { name: 'Vêtements femmes', slug: 'vetements-femmes', description: 'Mode féminine', icon: 'ShirtIcon' },
      { name: 'Vêtements hommes', slug: 'vetements-hommes', description: 'Mode masculine', icon: 'ShirtIcon' },
      { name: 'Accessoires', slug: 'accessoires', description: 'Sacs, bijoux, montres', icon: 'Watch' },
      { name: 'Soins beauté', slug: 'soins-beaute', description: 'Cosmétiques et soins', icon: 'Sparkles' },
      { name: 'Coiffure', slug: 'coiffure', description: 'Salons de coiffure', icon: 'Scissors' }
    ]
  },
  {
    name: 'Services',
    slug: 'services',
    description: 'Plomberie, électricité, ménage et autres services à domicile',
    icon: 'Wrench',
    color: 'bg-emerald-100 text-emerald-600',
    order: 6,
    subcategories: [
      { name: 'Ménage', slug: 'menage', description: 'Services de ménage', icon: 'Sparkles' },
      { name: 'Plomberie', slug: 'plomberie', description: 'Plombiers professionnels', icon: 'Droplet' },
      { name: 'Électricité', slug: 'electricite', description: 'Électriciens certifiés', icon: 'Zap' },
      { name: 'Jardinage', slug: 'jardinage', description: 'Entretien espaces verts', icon: 'Trees' },
      { name: 'Autres services', slug: 'autres', description: 'Services divers', icon: 'MoreHorizontal' }
    ]
  },
  {
    name: 'Maison & Jardin',
    slug: 'maison',
    description: 'Meubles, décoration et équipements pour la maison',
    icon: 'Home',
    color: 'bg-amber-100 text-amber-600',
    order: 7,
    subcategories: [
      { name: 'Meubles', slug: 'meubles', description: 'Canapés, tables, armoires', icon: 'Armchair' },
      { name: 'Décoration', slug: 'decoration', description: 'Objets déco, tableaux', icon: 'Palette' },
      { name: 'Électroménager', slug: 'electromenager', description: 'Appareils électroménagers', icon: 'Microwave' },
      { name: 'Jardin', slug: 'jardin', description: 'Outils et équipements jardin', icon: 'Trees' }
    ]
  },
  {
    name: 'Emploi',
    slug: 'emploi',
    description: 'Offres d\'emploi et services professionnels',
    icon: 'Briefcase',
    color: 'bg-indigo-100 text-indigo-600',
    order: 8,
    subcategories: [
      { name: 'CDI', slug: 'cdi', description: 'Contrats à durée indéterminée', icon: 'Briefcase' },
      { name: 'CDD', slug: 'cdd', description: 'Contrats à durée déterminée', icon: 'Calendar' },
      { name: 'Stage', slug: 'stage', description: 'Offres de stage', icon: 'GraduationCap' },
      { name: 'Freelance', slug: 'freelance', description: 'Missions freelance', icon: 'Laptop' }
    ]
  },
  {
    name: 'Loisirs & Divertissement',
    slug: 'loisirs',
    description: 'Sports, jeux, livres et activités de loisirs',
    icon: 'Gamepad2',
    color: 'bg-purple-100 text-purple-600',
    order: 9,
    subcategories: [
      { name: 'Sport', slug: 'sport', description: 'Équipements sportifs', icon: 'Dumbbell' },
      { name: 'Jeux vidéo', slug: 'jeux-video', description: 'Consoles et jeux', icon: 'Gamepad2' },
      { name: 'Livres', slug: 'livres', description: 'Livres et magazines', icon: 'Book' },
      { name: 'Musique', slug: 'musique', description: 'Instruments et matériel audio', icon: 'Music' }
    ]
  },
  {
    name: 'Matériaux & Équipements',
    slug: 'materiaux',
    description: 'Matériaux de construction et équipements professionnels',
    icon: 'HardHat',
    color: 'bg-slate-100 text-slate-600',
    order: 10,
    subcategories: [
      { name: 'Construction', slug: 'construction', description: 'Matériaux de construction', icon: 'Brick' },
      { name: 'Outillage', slug: 'outillage', description: 'Outils professionnels', icon: 'Hammer' },
      { name: 'Équipements pro', slug: 'equipements-pro', description: 'Matériel professionnel', icon: 'Factory' }
    ]
  }
];

// Fonction pour créer les catégories
const seedCategories = async () => {
  try {
    await connectDB();
    
    console.log('🗑️  Suppression des anciennes catégories...');
    await Category.deleteMany({});
    
    console.log('📦 Création des nouvelles catégories...');
    const categories = await Category.insertMany(categoriesData);
    
    console.log(`✅ ${categories.length} catégories créées avec succès!`);
    
    // Afficher les catégories créées
    categories.forEach(cat => {
      console.log(`  - ${cat.name} (${cat.slug}) - ${cat.subcategories.length} sous-catégories`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors du seeding:', error);
    process.exit(1);
  }
};

// Exécuter le seeding
seedCategories();
