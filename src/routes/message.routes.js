const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth');
const {
  getMessages,
  sendMessage,
  markMessageAsRead,
  deleteMessage,
  searchMessages,
  sendVoiceMessage
} = require('../controllers/message.controller');

// Configuration de multer pour l'upload en mémoire
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite à 10MB
  },
  fileFilter: (req, file, cb) => {
    // Accepter uniquement les fichiers audio
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers audio sont acceptés'), false);
    }
  }
});

// Routes protégées - nécessitent une authentification
router.use(protect);

// @route   POST /api/messages/voice
// @desc    Envoyer un message vocal
// @access  Private
router.post('/voice', upload.single('audio'), sendVoiceMessage);

// @route   POST /api/messages
// @desc    Envoyer un message
// @access  Private
router.post('/', sendMessage);

// @route   GET /api/messages/search/:conversationId
// @desc    Rechercher dans les messages d'une conversation
// @access  Private
router.get('/search/:conversationId', searchMessages);

// @route   GET /api/messages/:conversationId
// @desc    Obtenir les messages d'une conversation
// @access  Private
router.get('/:conversationId', getMessages);

// @route   PUT /api/messages/:id/read
// @desc    Marquer un message comme lu
// @access  Private
router.put('/:id/read', markMessageAsRead);

// @route   DELETE /api/messages/:id
// @desc    Supprimer un message
// @access  Private
router.delete('/:id', deleteMessage);

module.exports = router;
