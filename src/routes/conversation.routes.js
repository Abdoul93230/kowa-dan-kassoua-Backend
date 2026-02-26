const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getConversations,
  getConversationById,
  createOrGetConversation,
  markConversationAsRead,
  archiveConversation,
  getUnreadCount
} = require('../controllers/conversation.controller');

// Routes protégées - nécessitent une authentification
router.use(protect);

// @route   GET /api/conversations/unread/count
// @desc    Obtenir le nombre total de messages non lus
// @access  Private
router.get('/unread/count', getUnreadCount);

// @route   GET /api/conversations
// @desc    Obtenir toutes les conversations de l'utilisateur
// @access  Private
router.get('/', getConversations);

// @route   POST /api/conversations
// @desc    Créer ou récupérer une conversation
// @access  Private
router.post('/', createOrGetConversation);

// @route   GET /api/conversations/:id
// @desc    Obtenir une conversation spécifique
// @access  Private
router.get('/:id', getConversationById);

// @route   PUT /api/conversations/:id/read
// @desc    Marquer une conversation comme lue
// @access  Private
router.put('/:id/read', markConversationAsRead);

// @route   DELETE /api/conversations/:id
// @desc    Archiver une conversation
// @access  Private
router.delete('/:id', archiveConversation);

module.exports = router;
