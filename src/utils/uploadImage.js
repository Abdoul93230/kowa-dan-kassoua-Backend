const cloudinary = require('../config/cloudinary');

/**
 * 📤 Upload une image sur Cloudinary
 * @param {string} base64Image - Image en base64 (data:image/jpeg;base64,...)
 * @param {string} folder - Dossier Cloudinary (ex: 'avatars', 'products')
 * @param {string} publicId - ID public optionnel pour l'image
 * @returns {Promise<string>} URL de l'image uploadée
 */
const uploadImage = async (base64Image, folder = 'kowa', publicId = null) => {
  try {
    // ⚠️ Vérifier si Cloudinary est configuré
    if (!process.env.CLOUDINARY_CLOUD_NAME || 
        process.env.CLOUDINARY_CLOUD_NAME === 'your_cloud_name') {
      throw new Error('Cloudinary n\'est pas configuré. Veuillez ajouter CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET dans .env');
    }

    // 📤 Upload sur Cloudinary
    const uploadOptions = {
      folder: folder,
      resource_type: 'auto',
      transformation: [
        { width: 800, height: 800, crop: 'limit' }, // Limiter la taille
        { quality: 'auto:good' }, // Compression automatique
        { fetch_format: 'auto' } // Format optimal (WebP si supporté)
      ]
    };

    if (publicId) {
      uploadOptions.public_id = publicId;
    }

    const result = await cloudinary.uploader.upload(base64Image, uploadOptions);
    
    console.log('✅ Image uploadée sur Cloudinary:', result.secure_url);
    return result.secure_url;

  } catch (error) {
    console.error('❌ Erreur upload Cloudinary:', error.message);
    throw new Error(`Erreur lors de l'upload de l'image: ${error.message}`);
  }
};

/**
 * 🗑️ Supprimer une image de Cloudinary
 * @param {string} imageUrl - URL de l'image Cloudinary
 * @returns {Promise<boolean>} Succès de la suppression
 */
const deleteImage = async (imageUrl) => {
  try {
    // Extraire le public_id de l'URL Cloudinary
    const urlParts = imageUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    const publicId = filename.split('.')[0];
    const folder = urlParts[urlParts.length - 2];
    const fullPublicId = `${folder}/${publicId}`;

    await cloudinary.uploader.destroy(fullPublicId);
    console.log('🗑️ Image supprimée de Cloudinary:', fullPublicId);
    return true;

  } catch (error) {
    console.error('❌ Erreur suppression Cloudinary:', error.message);
    return false;
  }
};

/**
 * 📤 Upload plusieurs images
 * @param {Array<string>} base64Images - Tableau d'images en base64
 * @param {string} folder - Dossier Cloudinary
 * @param {string} publicIdPrefix - Préfixe optionnel pour les public_id
 * @returns {Promise<Array<string>>} Tableau d'URLs
 */
const uploadMultipleImages = async (base64Images, folder = 'kowa', publicIdPrefix = null) => {
  try {
    const uploadPromises = base64Images.map((image, index) => {
      const publicId = publicIdPrefix ? `${publicIdPrefix}_${index}` : null;
      return uploadImage(image, folder, publicId);
    });
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('❌ Erreur upload multiple:', error.message);
    throw new Error('Erreur lors de l\'upload des images');
  }
};

/**
 * 📤 Upload une image depuis un buffer (multipart/form-data)
 * @param {Buffer} buffer - Buffer de l'image
 * @param {string} folder - Dossier Cloudinary
 * @param {string} publicId - ID public optionnel
 * @returns {Promise<string>} URL de l'image uploadée
 */
const uploadImageBuffer = (buffer, folder = 'kowa', publicId = null) => {
  return new Promise((resolve, reject) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME ||
        process.env.CLOUDINARY_CLOUD_NAME === 'your_cloud_name') {
      reject(new Error('Cloudinary n\'est pas configuré'));
      return;
    }

    const uploadOptions = {
      folder,
      resource_type: 'auto',
      transformation: [
        { width: 800, height: 800, crop: 'limit' },
        { quality: 'auto:good' },
        { fetch_format: 'auto' }
      ]
    };

    if (publicId) uploadOptions.public_id = publicId;

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) {
        console.error('❌ Erreur upload Cloudinary (buffer):', error.message);
        reject(new Error(`Erreur upload Cloudinary: ${error.message}`));
      } else {
        console.log('✅ Image uploadée sur Cloudinary:', result.secure_url);
        resolve(result.secure_url);
      }
    });

    stream.end(buffer);
  });
};

module.exports = {
  uploadImage,
  uploadImageBuffer,
  deleteImage,
  uploadMultipleImages
};
