const Category = require('../models/Category');

// ===============================================
// @desc    Récupérer toutes les catégories actives
// @route   GET /api/categories
// @access  Public
// ===============================================
exports.getCategories = async (req, res) => {
  try {
    const { active = true, includeInactive = false } = req.query;
    
    // Filtre : uniquement les catégories actives par défaut
    const filter = includeInactive === 'true' ? {} : { active: true };
    
    const categories = await Category.find(filter)
      .sort('order name')
      .select('-__v');
    
    res.status(200).json({
      success: true,
      data: categories,
      count: categories.length
    });
  } catch (error) {
    console.error('❌ Erreur getCategories:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des catégories'
    });
  }
};

// ===============================================
// @desc    Récupérer une catégorie par slug
// @route   GET /api/categories/:slug
// @access  Public
// ===============================================
exports.getCategoryBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    
    const category = await Category.findOne({ slug, active: true })
      .select('-__v');
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('❌ Erreur getCategoryBySlug:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la catégorie'
    });
  }
};

// ===============================================
// @desc    Créer une nouvelle catégorie
// @route   POST /api/categories
// @access  Private/Admin
// ===============================================
exports.createCategory = async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      icon,
      image,
      color,
      subcategories,
      order,
      metaTitle,
      metaDescription
    } = req.body;
    
    // Vérifier si le slug existe déjà
    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Une catégorie avec ce slug existe déjà'
      });
    }
    
    // Créer la catégorie
    const category = await Category.create({
      name,
      slug,
      description,
      icon,
      image,
      color,
      subcategories,
      order,
      metaTitle,
      metaDescription
    });
    
    res.status(201).json({
      success: true,
      data: category,
      message: 'Catégorie créée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur createCategory:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Une catégorie avec ce nom ou slug existe déjà'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la catégorie',
      error: error.message
    });
  }
};

// ===============================================
// @desc    Mettre à jour une catégorie
// @route   PUT /api/categories/:id
// @access  Private/Admin
// ===============================================
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Ne pas permettre la modification directe des stats
    delete updates.productsCount;
    delete updates.servicesCount;
    
    const category = await Category.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    res.status(200).json({
      success: true,
      data: category,
      message: 'Catégorie mise à jour avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur updateCategory:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Une catégorie avec ce nom ou slug existe déjà'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de la catégorie',
      error: error.message
    });
  }
};

// ===============================================
// @desc    Supprimer une catégorie (soft delete)
// @route   DELETE /api/categories/:id
// @access  Private/Admin
// ===============================================
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Soft delete : marquer comme inactive
    const category = await Category.findByIdAndUpdate(
      id,
      { active: false },
      { new: true }
    );
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Catégorie désactivée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur deleteCategory:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de la catégorie'
    });
  }
};

// ===============================================
// @desc    Ajouter une sous-catégorie
// @route   POST /api/categories/:id/subcategories
// @access  Private/Admin
// ===============================================
exports.addSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, icon } = req.body;
    
    const category = await Category.findById(id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    // Vérifier si le slug existe déjà dans les sous-catégories
    const existingSubcat = category.subcategories.find(sub => sub.slug === slug);
    if (existingSubcat) {
      return res.status(400).json({
        success: false,
        message: 'Une sous-catégorie avec ce slug existe déjà'
      });
    }
    
    category.subcategories.push({ name, slug, description, icon });
    await category.save();
    
    res.status(201).json({
      success: true,
      data: category,
      message: 'Sous-catégorie ajoutée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur addSubcategory:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'ajout de la sous-catégorie'
    });
  }
};

// ===============================================
// @desc    Mettre à jour une sous-catégorie
// @route   PUT /api/categories/:id/subcategories/:subId
// @access  Private/Admin
// ===============================================
exports.updateSubcategory = async (req, res) => {
  try {
    const { id, subId } = req.params;
    const updates = req.body;
    
    const category = await Category.findById(id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    const subcategory = category.subcategories.id(subId);
    
    if (!subcategory) {
      return res.status(404).json({
        success: false,
        message: 'Sous-catégorie non trouvée'
      });
    }
    
    // Mettre à jour les champs
    Object.keys(updates).forEach(key => {
      subcategory[key] = updates[key];
    });
    
    await category.save();
    
    res.status(200).json({
      success: true,
      data: category,
      message: 'Sous-catégorie mise à jour avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur updateSubcategory:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour de la sous-catégorie'
    });
  }
};

// ===============================================
// @desc    Supprimer une sous-catégorie
// @route   DELETE /api/categories/:id/subcategories/:subId
// @access  Private/Admin
// ===============================================
exports.deleteSubcategory = async (req, res) => {
  try {
    const { id, subId } = req.params;
    
    const category = await Category.findById(id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    category.subcategories.pull(subId);
    await category.save();
    
    res.status(200).json({
      success: true,
      data: category,
      message: 'Sous-catégorie supprimée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur deleteSubcategory:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de la sous-catégorie'
    });
  }
};

// ===============================================
// @desc    Mettre à jour les statistiques d'une catégorie
// @route   POST /api/categories/:id/update-stats
// @access  Private/Admin
// ===============================================
exports.updateCategoryStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const category = await Category.findById(id);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Catégorie non trouvée'
      });
    }
    
    await category.updateStats();
    
    res.status(200).json({
      success: true,
      data: category,
      message: 'Statistiques mises à jour avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur updateCategoryStats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour des statistiques'
    });
  }
};

// ===============================================
// @desc    Mettre à jour les statistiques de toutes les catégories
// @route   POST /api/categories/update-all-stats
// @access  Private/Admin
// ===============================================
exports.updateAllCategoriesStats = async (req, res) => {
  try {
    await Category.updateAllStats();
    
    const categories = await Category.find().sort('order name');
    
    res.status(200).json({
      success: true,
      data: categories,
      message: 'Toutes les statistiques ont été mises à jour avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur updateAllCategoriesStats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour des statistiques'
    });
  }
};
