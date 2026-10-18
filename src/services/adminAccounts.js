// Comptes administrateurs : création et nouveau mot de passe, toujours envoyés par e-mail.
// Le mot de passe temporaire n'est jamais renvoyé par l'API ni affiché : seul le
// destinataire le reçoit, et il doit le changer à la première connexion.

const crypto = require('crypto');
const User = require('../models/User');
const { sendAdminInviteEmail } = require('./emailService');

const LOGIN_URL = `${String(process.env.PUBLIC_WEB_URL || 'https://taktak-ne.com').replace(/\/$/, '')}/login`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 12 caractères sans ambiguïté (pas de 0/O, 1/l/I), tirés de façon cryptographique
function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Crée un administrateur (ou donne les droits admin à un compte existant) et
 * envoie ses accès par e-mail. Si l'e-mail ne part pas, rien n'est enregistré.
 */
async function createAdmin({ email, name }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) throw httpError(400, 'Adresse e-mail invalide.');
  const displayName = String(name || '').trim() || normalizedEmail.split('@')[0];
  if (displayName.length < 2) throw httpError(400, 'Le nom doit contenir au moins 2 caractères.');

  // +password : nécessaire pour remettre l'ancien mot de passe si l'e-mail ne part pas
  const existing = await User.findOne({ email: normalizedEmail }).select('+password +refreshTokens');
  if (existing?.role === 'admin') throw httpError(409, 'Ce compte est déjà administrateur.');

  const tempPassword = generateTempPassword();

  if (existing) {
    // Compte existant : il devient admin avec un nouveau mot de passe temporaire
    const previous = { role: existing.role, password: existing.password, needsPasswordChange: existing.needsPasswordChange };
    existing.role = 'admin';
    existing.password = tempPassword;
    existing.needsPasswordChange = true;
    existing.refreshTokens = [];
    await existing.save();
    try {
      await sendAdminInviteEmail(normalizedEmail, tempPassword, LOGIN_URL);
    } catch (error) {
      // E-mail impossible : on remet le compte dans son état d'origine
      await User.updateOne({ _id: existing._id }, { $set: previous });
      throw httpError(502, `E-mail non envoyé (${error.message}). Aucune modification enregistrée.`);
    }
    return { user: existing, promoted: true };
  }

  const user = await User.create({
    name: displayName,
    email: normalizedEmail,
    password: tempPassword,
    role: 'admin',
    needsPasswordChange: true,
  });
  try {
    await sendAdminInviteEmail(normalizedEmail, tempPassword, LOGIN_URL);
  } catch (error) {
    await User.deleteOne({ _id: user._id });
    throw httpError(502, `E-mail non envoyé (${error.message}). Le compte n'a pas été créé.`);
  }
  return { user, promoted: false };
}

/** Nouveau mot de passe temporaire pour un administrateur (envoyé par e-mail) */
async function resendAdminPassword(userId) {
  const user = await User.findById(userId).select('+password +refreshTokens');
  if (!user || user.role !== 'admin') throw httpError(404, 'Administrateur introuvable.');
  if (!user.email) throw httpError(400, 'Ce compte n\'a pas d\'adresse e-mail.');
  const previous = { password: user.password, needsPasswordChange: user.needsPasswordChange };
  const tempPassword = generateTempPassword();
  user.password = tempPassword;
  user.needsPasswordChange = true;
  user.refreshTokens = [];
  await user.save();
  try {
    await sendAdminInviteEmail(user.email, tempPassword, LOGIN_URL);
  } catch (error) {
    await User.updateOne({ _id: user._id }, { $set: previous });
    throw httpError(502, `E-mail non envoyé (${error.message}). Le mot de passe n'a pas changé.`);
  }
  return user;
}

/** Retire les droits admin (jamais le dernier administrateur) */
async function revokeAdmin(userId, requesterId) {
  if (String(userId) === String(requesterId)) throw httpError(400, 'Vous ne pouvez pas retirer vos propres droits.');
  const user = await User.findById(userId);
  if (!user || user.role !== 'admin') throw httpError(404, 'Administrateur introuvable.');
  const admins = await User.countDocuments({ role: 'admin', isActive: { $ne: false } });
  if (admins <= 1) throw httpError(400, 'Il doit rester au moins un administrateur.');
  user.role = 'seller'; // rôle par défaut des comptes
  user.refreshTokens = [];
  await user.save();
  return user;
}

module.exports = { createAdmin, resendAdminPassword, revokeAdmin, generateTempPassword };
