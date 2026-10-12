// ─── Redis (facultatif) ─────────────────────────────────────────────────────
// Activé uniquement si REDIS_URL est défini dans .env (ex. redis://localhost:6379).
// Sans Redis, l'app fonctionne comme avant : cache en mémoire et un seul serveur.
// Avec Redis : cache partagé entre serveurs + Socket.IO multi-serveurs (adaptateur).

const { createClient } = require('redis');

const CONNECT_TIMEOUT_MS = 5000;
let client = null;

// Client prêt, ou null (Redis absent ou momentanément indisponible → repli sur la mémoire)
const getRedis = () => (client && client.isReady ? client : null);

async function connectRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const candidate = createClient({
    url,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Reconnexion progressive en cas de coupure (jusqu'à 5 s entre deux essais)
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });

  let lastError = '';
  candidate.on('error', (error) => {
    if (error.message !== lastError) console.error('⚠️ Redis:', error.message);
    lastError = error.message;
  });

  try {
    await Promise.race([
      candidate.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('délai de connexion dépassé')), CONNECT_TIMEOUT_MS)),
    ]);
    client = candidate;
    console.log('✅ Redis connecté');
    return client;
  } catch (error) {
    console.error(`⚠️ Redis indisponible (${error.message}) : cache en mémoire, serveur unique`);
    try {
      await candidate.disconnect();
    } catch (e) {
      // déjà fermé
    }
    return null;
  }
}

module.exports = { connectRedis, getRedis };
