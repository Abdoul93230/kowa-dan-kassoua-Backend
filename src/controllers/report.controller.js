// Signalements d'annonces
// • Un utilisateur connecté signale une annonce (une fois par annonce).
// • Chaque signalement est enregistré et les admins sont prévenus par e-mail.
// • Au-delà de REPORT_HIDE_THRESHOLD signalements distincts (3 par défaut),
//   l'annonce est masquée automatiquement (statut « pending ») en attendant la décision d'un admin.
// • Les admins traitent les signalements : retirer l'annonce ou rejeter le signalement.

const Report = require('../models/Report');
const Product = require('../models/Product');
const User = require('../models/User');
const cache = require('../utils/cache');
const { sendEmail } = require('../services/emailService');
const { REPORT_REASONS, REPORT_REASON_LABELS } = Report;

const HIDE_THRESHOLD = Math.max(1, Number(process.env.REPORT_HIDE_THRESHOLD) || 3);
const WEB_URL = String(process.env.PUBLIC_WEB_URL || 'https://taktak-ne.com').replace(/\/$/, '');

const invalidatePublicCaches = () => {
  cache.invalidate('home:');
  cache.invalidate('public:');
};

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Destinataires : REPORT_EMAILS (séparés par des virgules), sinon les comptes admin, sinon l'adresse SMTP
async function adminRecipients() {
  const fromEnv = String(process.env.REPORT_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const admins = await User.find({ role: 'admin', email: { $exists: true, $ne: '' } }).select('email').lean();
  const emails = admins.map((a) => a.email).filter(Boolean);
  return emails.length ? emails : [process.env.SMTP_EMAIL].filter(Boolean);
}

// E-mail aux admins (sans bloquer la réponse à l'utilisateur)
async function notifyAdmins({ product, reporter, reason, details, openCount, hidden }) {
  try {
    const to = await adminRecipients();
    if (!to.length) return;
    const label = REPORT_REASON_LABELS[reason] || reason;
    const link = `${WEB_URL}/items/${product._id}`;
    const subject = `${hidden ? '🚫 Annonce masquée' : '⚠️ Signalement'} — ${label} — « ${product.title} »`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
        <h2 style="margin:0 0 12px">${hidden ? 'Annonce masquée automatiquement' : 'Nouvelle annonce signalée'}</h2>
        <p style="margin:0 0 16px;color:#4b5563">
          ${openCount} signalement${openCount > 1 ? 's' : ''} en attente sur cette annonce.
          ${hidden ? `Elle a été retirée de la vue publique (seuil : ${HIDE_THRESHOLD}) en attendant votre décision.` : ''}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#6b7280;width:140px">Annonce</td><td><a href="${link}">${escapeHtml(product.title)}</a></td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Motif</td><td><strong>${escapeHtml(label)}</strong></td></tr>
          ${details ? `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Précisions</td><td>${escapeHtml(details)}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#6b7280">Signalé par</td><td>${escapeHtml(reporter.name || '')} (${escapeHtml(reporter.phone || reporter.email || reporter._id)})</td></tr>
        </table>
        <p style="margin:20px 0 0"><a href="${WEB_URL}/admin/signalements" style="background:#ec5a13;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:bold">Traiter les signalements</a></p>
      </div>`;
    const text = `${subject}\n${openCount} signalement(s) en attente.\nAnnonce : ${link}\nMotif : ${label}${details ? `\nPrécisions : ${details}` : ''}\nTraiter : ${WEB_URL}/admin/signalements`;
    await sendEmail({ to: to.join(','), subject, html, text });
  } catch (error) {
    console.error('⚠️ E-mail de signalement non envoyé :', error.message);
  }
}

// @route POST /api/reports — signaler une annonce (connecté)
exports.createReport = async (req, res) => {
  try {
    const { productId, reason, details } = req.body || {};
    if (!productId || !REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: 'Choisissez un motif de signalement.' });
    }
    const product = await Product.findById(productId).select('title seller status');
    if (!product) return res.status(404).json({ success: false, message: 'Annonce introuvable.' });
    if (String(product.seller) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas signaler votre propre annonce.' });
    }

    try {
      await Report.create({
        product: product._id,
        seller: product.seller,
        reporter: req.user.id,
        reason,
        details: String(details || '').trim().slice(0, 500),
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(200).json({ success: true, alreadyReported: true, message: 'Vous avez déjà signalé cette annonce. Merci, nous l\'examinons.' });
      }
      throw error;
    }

    // Masquage automatique au-delà du seuil (signalements distincts encore ouverts)
    const openCount = await Report.countDocuments({ product: product._id, status: 'open' });
    let hidden = false;
    if (openCount >= HIDE_THRESHOLD && product.status === 'active') {
      product.status = 'pending';
      await product.save();
      invalidatePublicCaches();
      hidden = true;
    }

    const reporter = await User.findById(req.user.id).select('name phone email').lean();
    notifyAdmins({ product, reporter: reporter || { _id: req.user.id }, reason, details, openCount, hidden });

    res.status(201).json({ success: true, message: 'Merci ! Notre équipe va examiner cette annonce.' });
  } catch (error) {
    console.error('❌ Erreur signalement :', error);
    res.status(500).json({ success: false, message: 'Impossible d\'envoyer le signalement.' });
  }
};

// @route GET /api/reports?status=open — signalements regroupés par annonce (admin)
exports.listReports = async (req, res) => {
  try {
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const reports = await Report.find({ status })
      .sort('-createdAt')
      .limit(500)
      .populate('product', 'title mainImage price status type')
      .populate('seller', 'name phone email')
      .populate('reporter', 'name phone email')
      .lean();

    const byProduct = new Map();
    for (const r of reports) {
      if (!r.product) continue;
      const key = String(r.product._id);
      if (!byProduct.has(key)) byProduct.set(key, { product: r.product, seller: r.seller, reports: [] });
      byProduct.get(key).reports.push({
        id: String(r._id),
        reason: r.reason,
        reasonLabel: REPORT_REASON_LABELS[r.reason] || r.reason,
        details: r.details,
        reporter: r.reporter ? { name: r.reporter.name, contact: r.reporter.phone || r.reporter.email || '' } : null,
        createdAt: r.createdAt,
      });
    }
    const items = [...byProduct.values()].sort((a, b) => b.reports.length - a.reports.length);
    res.json({ success: true, data: items, reasons: REPORT_REASON_LABELS, hideThreshold: HIDE_THRESHOLD });
  } catch (error) {
    console.error('❌ Erreur liste signalements :', error);
    res.status(500).json({ success: false, message: 'Impossible de charger les signalements.' });
  }
};

// @route PATCH /api/reports/product/:productId — décision d'un admin
// body.action : 'remove' (annonce masquée, signalements résolus) | 'dismiss' (annonce rétablie, signalements rejetés)
exports.handleProductReports = async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['remove', 'dismiss'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action invalide.' });
    }
    const product = await Product.findById(req.params.productId).select('status');
    if (!product) return res.status(404).json({ success: false, message: 'Annonce introuvable.' });

    const nextStatus = action === 'remove' ? 'resolved' : 'dismissed';
    const result = await Report.updateMany(
      { product: product._id, status: 'open' },
      { $set: { status: nextStatus, handledBy: req.user.id, handledAt: new Date() } }
    );

    if (action === 'remove' && product.status !== 'expired') product.status = 'expired';
    if (action === 'dismiss' && product.status === 'pending') product.status = 'active';
    await product.save();
    invalidatePublicCaches();

    res.json({ success: true, handled: result.modifiedCount, productStatus: product.status });
  } catch (error) {
    console.error('❌ Erreur traitement signalement :', error);
    res.status(500).json({ success: false, message: 'Impossible de traiter les signalements.' });
  }
};
