const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

// Placeholder controllers - à implémenter
router.get('/', protect, (req, res) => {
  res.json({ success: true, data: [] });
});

module.exports = router;
