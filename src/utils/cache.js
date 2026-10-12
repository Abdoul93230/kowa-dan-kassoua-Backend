// Cache à expiration, avec déduplication des chargements concurrents :
// si 500 clients demandent l'accueil au même instant, une seule requête part en base.
//
// - Avec Redis (REDIS_URL) : cache partagé par tous les serveurs.
// - Sans Redis, ou si Redis tombe : cache en mémoire de ce serveur (repli automatique).

const { getRedis } = require('../config/redis');

const MAX_ENTRIES = 500;
const REDIS_PREFIX = 'taktak:cache:';
const store = new Map();    // clé -> { value, expires }   (mémoire locale)
const inflight = new Map(); // clé -> Promise en cours

async function readShared(key) {
  const redis = getRedis();
  if (!redis) return undefined;
  try {
    const raw = await redis.get(REDIS_PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch (error) {
    return undefined; // Redis lent ou indisponible : on recalcule
  }
}

function writeShared(key, value, ttlMs) {
  const redis = getRedis();
  if (!redis) return;
  redis
    .set(REDIS_PREFIX + key, JSON.stringify(value), { PX: ttlMs })
    .catch(() => {});
}

function writeLocal(key, value, ttlMs) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // plus ancienne entrée
  store.set(key, { value, expires: Date.now() + ttlMs });
}

async function wrap(key, ttlMs, loader) {
  if (!getRedis()) {
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
  }
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const shared = await readShared(key);
      if (shared !== undefined) return shared;

      const value = await loader();
      if (getRedis()) writeShared(key, value, ttlMs);
      else writeLocal(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

// Supprime toutes les entrées dont la clé commence par `prefix` (mémoire + Redis)
function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }

  const redis = getRedis();
  if (!redis) return;
  (async () => {
    const keys = [];
    for await (const key of redis.scanIterator({ MATCH: `${REDIS_PREFIX}${prefix}*`, COUNT: 200 })) {
      keys.push(key);
    }
    if (keys.length) await redis.del(keys);
  })().catch((error) => console.error('⚠️ Invalidation cache Redis:', error.message));
}

module.exports = { wrap, invalidate };
