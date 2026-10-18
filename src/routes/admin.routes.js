// Gestion de l'équipe d'administration (réservé aux admins)
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const { createAdmin, resendAdminPassword, revokeAdmin } = require('../services/adminAccounts');

router.use(protect, authorize('admin'));

const send = (res, error) => {
  if (!error.status) console.error('❌ Admin :', error);
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Erreur serveur' });
};

const toAdminJSON = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email || '',
  needsPasswordChange: Boolean(u.needsPasswordChange),
  createdAt: u.createdAt,
});

// @route GET /api/admin/admins — liste des administrateurs
router.get('/admins', async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).sort('createdAt').select('name email needsPasswordChange createdAt').lean();
    res.json({ success: true, data: admins.map(toAdminJSON), me: String(req.user._id) });
  } catch (error) { send(res, error); }
});

// @route POST /api/admin/admins { email, name } — invite un administrateur (accès envoyés par e-mail)
router.post('/admins', async (req, res) => {
  try {
    const { user, promoted } = await createAdmin(req.body || {});
    res.status(201).json({
      success: true,
      data: toAdminJSON(user),
      message: promoted
        ? `Le compte ${user.email} est maintenant administrateur. Ses accès lui ont été envoyés par e-mail.`
        : `Administrateur créé. Ses accès ont été envoyés à ${user.email}.`,
    });
  } catch (error) { send(res, error); }
});

// @route POST /api/admin/admins/:id/reset-password — nouveau mot de passe temporaire par e-mail
router.post('/admins/:id/reset-password', async (req, res) => {
  try {
    const user = await resendAdminPassword(req.params.id);
    res.json({ success: true, message: `Un nouveau mot de passe a été envoyé à ${user.email}.` });
  } catch (error) { send(res, error); }
});

// @route DELETE /api/admin/admins/:id — retire les droits admin (le compte reste)
router.delete('/admins/:id', async (req, res) => {
  try {
    const user = await revokeAdmin(req.params.id, req.user._id);
    res.json({ success: true, message: `${user.name} n'est plus administrateur.` });
  } catch (error) { send(res, error); }
});

module.exports = router;
