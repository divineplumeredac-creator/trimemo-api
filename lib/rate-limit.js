const buckets = new Map();

export function clientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function localRateLimit(req, key, max, windowMs) {
  const id = key + ':' + clientIp(req);
  const now = Date.now();
  const hits = (buckets.get(id) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const e = new Error('Trop de requêtes. Réessayez dans quelques minutes.');
    e.status = 429;
    throw e;
  }
  hits.push(now);
  buckets.set(id, hits);
  if (buckets.size > 5000) buckets.clear();
}

export async function rateLimit(req, key, max, windowMs) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) return localRateLimit(req, key, max, windowMs);

  const redisKey = `trimemo:ratelimit:${key}:${clientIp(req)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      ['INCR', redisKey],
      ['PEXPIRE', redisKey, windowMs, 'NX'],
    ]),
  });
  if (!response.ok) return localRateLimit(req, key, max, windowMs);
  const data = await response.json().catch(() => []);
  const count = Number(data?.[0]?.result || 0);
  if (count > max) {
    const e = new Error('Trop de requêtes. Réessayez dans quelques minutes.');
    e.status = 429;
    throw e;
  }
}
