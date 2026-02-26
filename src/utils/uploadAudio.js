const cloudinary = require('../config/cloudinary');

/**
 * 🎤 Upload un fichier audio sur Cloudinary
 * @param {Buffer} audioBuffer - Buffer du fichier audio
 * @param {string} folder - Dossier Cloudinary (ex: 'voice-messages')
 * @param {string} publicId - ID public optionnel pour l'audio
 * @returns {Promise<{url: string, duration: number}>} URL et durée de l'audio
 */
const uploadAudio = async (audioBuffer, folder = 'kowa/voice-messages', publicId = null) => {
  try {
    // ⚠️ Vérifier si Cloudinary est configuré
    if (!process.env.CLOUDINARY_CLOUD_NAME || 
        process.env.CLOUDINARY_CLOUD_NAME === 'your_cloud_name') {
      throw new Error('Cloudinary n\'est pas configuré. Veuillez ajouter CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET dans .env');
    }

    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder: folder,
        resource_type: 'video', // Cloudinary utilise 'video' pour les fichiers audio
        format: 'mp3', // Convertir en MP3 pour compatibilité
        transformation: [
          { audio_codec: 'mp3', bit_rate: '128k' } // Compression audio
        ]
      };

      if (publicId) {
        uploadOptions.public_id = publicId;
      }

      // Upload depuis un stream/buffer
      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('❌ Erreur upload audio Cloudinary:', error.message);
            reject(new Error(`Erreur lors de l'upload de l'audio: ${error.message}`));
          } else {
            console.log('✅ Audio uploadé sur Cloudinary:', result.secure_url);
            resolve({
              url: result.secure_url,
              duration: result.duration || 0, // Durée en secondes
              publicId: result.public_id
            });
          }
        }
      );

      // Écrire le buffer dans le stream
      uploadStream.end(audioBuffer);
    });

  } catch (error) {
    console.error('❌ Erreur upload audio:', error.message);
    throw new Error(`Erreur lors de l'upload de l'audio: ${error.message}`);
  }
};

/**
 * 🗑️ Supprimer un audio de Cloudinary
 * @param {string} audioUrl - URL de l'audio Cloudinary
 * @returns {Promise<boolean>} Succès de la suppression
 */
const deleteAudio = async (audioUrl) => {
  try {
    // Extraire le public_id de l'URL Cloudinary
    const urlParts = audioUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    const publicId = filename.split('.')[0];
    const folder = urlParts.slice(urlParts.indexOf('kowa'), -1).join('/');
    const fullPublicId = `${folder}/${publicId}`;

    await cloudinary.uploader.destroy(fullPublicId, { resource_type: 'video' });
    console.log('🗑️ Audio supprimé de Cloudinary:', fullPublicId);
    return true;

  } catch (error) {
    console.error('❌ Erreur suppression audio Cloudinary:', error.message);
    return false;
  }
};

module.exports = {
  uploadAudio,
  deleteAudio
};
