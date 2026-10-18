const nodemailer = require("nodemailer");

const APP_NAME = "TakTak";

let cachedTransporter = null;

const getConfig = () => {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_EMAIL || "").trim();
  const password = String(process.env.SMTP_PASSWORD || "");
  const from = String(process.env.SMTP_FROM || "").trim() || `${APP_NAME} <${user}>`;
  // 465 = SSL direct, sinon STARTTLS
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? String(process.env.SMTP_SECURE).toLowerCase() === "true"
      : port === 465;

  return { host, port, user, password, from, secure };
};

const assertReady = () => {
  const config = getConfig();

  if (!config.host || !config.user || !config.password) {
    const error = new Error("Configuration SMTP manquante (SMTP_HOST, SMTP_EMAIL, SMTP_PASSWORD)");
    error.code = "EMAIL_MISSING_CONFIG";
    throw error;
  }

  return config;
};

const getTransporter = (config) => {
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });

  return cachedTransporter;
};

const sendEmail = async ({ to, subject, text, html }) => {
  const config = assertReady();
  const recipient = String(to || "").trim();

  if (!recipient) {
    const error = new Error("Destinataire email manquant");
    error.code = "EMAIL_MISSING_RECIPIENT";
    throw error;
  }

  const info = await getTransporter(config).sendMail({
    from: config.from,
    to: recipient,
    subject,
    text,
    html,
  });

  return { messageId: info.messageId };
};

// Gabarit HTML simple pour les codes à usage unique
const buildCodeHtml = ({ title, intro, code, footer }) => `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:#0f172a;padding:20px 24px;border-bottom:3px solid #ec5a13">
      <span style="color:#ffffff;font-size:20px;font-weight:800">${APP_NAME}</span>
    </div>
    <div style="padding:28px 24px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#111827">${title}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#4b5563">${intro}</p>
      <div style="text-align:center;margin:0 0 20px">
        <span style="display:inline-block;padding:14px 24px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;font-size:30px;font-weight:800;letter-spacing:8px;color:#ec5a13">${code}</span>
      </div>
      <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280">${footer}</p>
    </div>
  </div>
</div>`;

const sendOtpEmail = (to, code) =>
  sendEmail({
    to,
    subject: `${APP_NAME} - Votre code de vérification`,
    text: `${APP_NAME} - Votre code de verification est : ${code}. Valable 10 minutes.`,
    html: buildCodeHtml({
      title: "Vérifiez votre adresse email",
      intro: "Saisissez ce code dans l'application pour confirmer votre adresse email.",
      code,
      footer: "Ce code est valable 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet email.",
    }),
  });

const sendResetCodeEmail = (to, code) =>
  sendEmail({
    to,
    subject: `${APP_NAME} - Réinitialisation de votre mot de passe`,
    text: `${APP_NAME} - Code de reinitialisation : ${code}. Valable 10 minutes.`,
    html: buildCodeHtml({
      title: "Réinitialisation du mot de passe",
      intro: "Utilisez ce code pour choisir un nouveau mot de passe.",
      code,
      footer: "Ce code est valable 10 minutes. Si vous n'avez pas fait cette demande, ignorez cet email : votre mot de passe reste inchangé.",
    }),
  });

const sendTempPasswordEmail = (to, tempPassword) =>
  sendEmail({
    to,
    subject: `${APP_NAME} - Votre mot de passe temporaire`,
    text: `${APP_NAME} - Votre mot de passe temporaire : ${tempPassword}. Changez-le dans votre profil.`,
    html: buildCodeHtml({
      title: "Bienvenue sur TakTak !",
      intro: "Votre compte a été créé. Voici votre mot de passe temporaire pour vous connecter :",
      code: tempPassword,
      footer: "Pensez à le changer depuis votre profil.",
    }),
  });

// Invitation d'un administrateur : identifiant + mot de passe temporaire
const sendAdminInviteEmail = (to, tempPassword, loginUrl) =>
  sendEmail({
    to,
    subject: `${APP_NAME} - Votre accès administrateur`,
    text: `${APP_NAME} - Accès administrateur. Identifiant : ${to}. Mot de passe temporaire : ${tempPassword}. Connectez-vous sur ${loginUrl} et changez-le dès la première connexion.`,
    html: buildCodeHtml({
      title: "Votre accès administrateur",
      intro: `Un compte administrateur TakTak a été créé pour ${to}. Connectez-vous avec cette adresse e-mail et ce mot de passe temporaire :`,
      code: tempPassword,
      footer: `Connexion : ${loginUrl}. Vous devrez choisir votre propre mot de passe à la première connexion. Si vous n'attendiez pas cet accès, ignorez cet e-mail.`,
    }),
  });

module.exports = {
  sendEmail,
  sendAdminInviteEmail,
  sendOtpEmail,
  sendResetCodeEmail,
  sendTempPasswordEmail,
};
