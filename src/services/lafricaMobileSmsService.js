const axios = require("axios");

const DEFAULT_BASE_URL = "https://lamsms.lafricamobile.com";

const trimTrailingSlash = (value = "") => value.replace(/\/+$/, "");

const normalizeRecipient = (value = "") => {
  const compact = String(value).replace(/\s+/g, "").trim();
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  return compact;
};

const sanitizeSender = (value = "") => String(value).trim();

const isSenderValid = (sender = "") => {
  if (!sender) return false;
  if (/^\d/.test(sender)) return false;
  if (sender.length > 11) return false;
  return /^[A-Za-z0-9_]+$/.test(sender);
};

const getConfig = () => {
  const accountId =
    process.env.LAFRICA_SMS_ACCOUNT_ID || process.env.ACCESS_KEY_AFRICAMOBILE || "";
  const password =
    process.env.LAFRICA_SMS_PASSWORD || process.env.ACCESS_PASSWORD_AFRICAMOBILE || "";
  const sender = sanitizeSender(process.env.LAFRICA_SMS_SENDER || "IHAMBAOBAB");
  const baseUrl = trimTrailingSlash(process.env.LAFRICA_SMS_BASE_URL || DEFAULT_BASE_URL);
  const enabled = String(process.env.LAFRICA_SMS_ENABLED || "false").toLowerCase() === "true";

  return {
    accountId,
    password,
    sender,
    baseUrl,
    enabled,
  };
};

const assertReady = () => {
  const config = getConfig();

  if (!config.enabled) {
    const error = new Error("LAfricaMobile SMS est desactive (LAFRICA_SMS_ENABLED=false)");
    error.code = "SMS_DISABLED";
    throw error;
  }

  if (!config.accountId || !config.password) {
    const error = new Error("Identifiants LAfricaMobile manquants");
    error.code = "SMS_MISSING_CREDENTIALS";
    throw error;
  }

  if (!isSenderValid(config.sender)) {
    const error = new Error(
      "Sender SMS invalide. Utiliser 11 caracteres max, sans commencer par un chiffre"
    );
    error.code = "SMS_INVALID_SENDER";
    throw error;
  }

  return config;
};

const sendSms = async ({ to, text, retId, retUrl }) => {
  const config = assertReady();
  const recipient = normalizeRecipient(to);
  const content = String(text || "").trim();

  if (!recipient) {
    const error = new Error("Destinataire SMS manquant");
    error.code = "SMS_MISSING_RECIPIENT";
    throw error;
  }

  if (!content) {
    const error = new Error("Contenu SMS vide");
    error.code = "SMS_EMPTY_TEXT";
    throw error;
  }

  const payload = {
    accountid: config.accountId,
    password: config.password,
    sender: config.sender,
    text: content,
    to: recipient,
  };

  if (retId) payload.ret_id = String(retId);
  if (retUrl) payload.ret_url = String(retUrl);

  const response = await axios.post(`${config.baseUrl}/api`, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "text/plain, application/json, */*",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const error = new Error("Erreur fournisseur SMS");
    error.code = "SMS_PROVIDER_ERROR";
    error.status = response.status;
    error.providerBody = response.data;
    throw error;
  }

  const providerMessageId = String(response.data ?? "").trim();

  return {
    providerMessageId,
    raw: response.data,
  };
};

const checkCredits = async () => {
  const config = assertReady();

  const response = await axios.get(`${config.baseUrl}/credits`, {
    params: {
      accountid: config.accountId,
      password: config.password,
    },
    timeout: 15000,
    responseType: "text",
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const error = new Error("Erreur lors de la verification des credits SMS");
    error.code = "SMS_CREDITS_ERROR";
    error.status = response.status;
    error.providerBody = response.data;
    throw error;
  }

  return {
    raw: response.data,
  };
};

module.exports = {
  sendSms,
  checkCredits,
};
