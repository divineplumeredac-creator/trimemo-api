export function clientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function failClosedError(message = 'Le service de limitation est temporairement indisponible.') {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function redisConfig() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname || !token || /[\r\n"' ]/.test(token) || /UPSTASH_REDIS_REST_(URL|TOKEN)=/.test(token)) {
    if (process.env.NODE_ENV !== 'production') return null;
    throw failClosedError();
  }
  return { url: url.replace(/\/$/, ''), token };
}

async function incrementDistributed(key, windowMs) {
  const config = redisConfig();
  if (!config) return null;
  let response;
  try {
    response = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['PEXPIRE', key, windowMs, 'NX'],
      ]),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    if (process.env.NODE_ENV !== 'production') return null;
    throw failClosedError();
  }
  if (!response.ok) {
    if (process.env.NODE_ENV !== 'production') return null;
    throw failClosedError();
  }
  const data = await response.json().catch(() => null);
  const count = Number(data?.[0]?.result);
  if (!Number.isSafeInteger(count) || count < 1 || data?.[0]?.error) {
    if (process.env.NODE_ENV !== 'production') return null;
    throw failClosedError();
  }
  return count;
}

const localBuckets = new Map();
function localRateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (localBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (hits.length >= max) {
    const error = new Error('Trop de requêtes. Réessayez dans quelques minutes.');
    error.status = 429;
    throw error;
  }
  hits.push(now);
  localBuckets.set(key, hits);
  if (localBuckets.size > 5000) localBuckets.clear();
}

function enforceLimit(count, max) {
  if (count > max) {
    const error = new Error('Trop de requêtes. Réessayez dans quelques minutes.');
    error.status = 429;
    throw error;
  }
}

export async function rateLimit(req, key, max, windowMs) {
  const redisKey = `trimemo:ratelimit:${String(key).slice(0, 100)}:${clientIp(req)}`;
  const count = await incrementDistributed(redisKey, windowMs);
  if (count === null) return localRateLimit(redisKey, max, windowMs);
  enforceLimit(count, max);
}

export async function rateLimitByKey(key, max, windowMs) {
  const safeKey = String(key || 'unknown').slice(0, 200);
  const count = await incrementDistributed(`trimemo:ratelimit:keyed:${safeKey}`, windowMs);
  if (count === null) return localRateLimit(`keyed:${safeKey}`, max, windowMs);
  enforceLimit(count, max);
}
