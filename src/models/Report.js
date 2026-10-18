const mongoose = require('mongoose');

// Motifs proposés aux utilisateurs (libellés affichés côté apps)
const REPORT_REASONS = ['nudity', 'scam', 'prohibited', 'offensive', 'misleading', 'duplicate', 'other'];

const REPORT_REASON_LABELS = {
  nudity: 'Nudité ou contenu sexuel',
  scam: 'Arnaque ou fraude',
  prohibited: 'Produit ou service interdit',
  offensive: 'Contenu choquant ou haineux',
  misleading: 'Annonce trompeuse ou incohérente',
  duplicate: 'Doublon ou spam',
  other: 'Autre',
};

const reportSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  details: { type: String, trim: true, maxlength: 500, default: '' },
  // open : à traiter · resolved : annonce retirée · dismissed : signalement rejeté
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  handledAt: { type: Date, default: null },
}, { timestamps: true });

// Un utilisateur ne signale qu'une fois la même annonce
reportSchema.index({ reporter: 1, product: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ product: 1, status: 1 });

module.exports = mongoose.model('Report', reportSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
module.exports.REPORT_REASON_LABELS = REPORT_REASON_LABELS;
