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
  // Une variable Vercel mal copiée (plusieurs affectations dans une seule valeur)
  // ne doit jamais faire échouer une fonctionnalité métier : repli local sécurisé.
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return localRateLimit(req, key, max, windowMs); }
  if (!url || !token || parsedUrl.protocol !== "https:" || !parsedUrl.hostname ||
      /[\\r\\n"' ]/.test(token) || /UPSTASH_REDIS_REST_(URL|TOKEN)=/.test(token)) {
    return localRateLimit(req, key, max, windowMs);
  }

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

const keyedBuckets = new Map();

export async function rateLimitByKey(key, max, windowMs) {
  const safeKey = String(key || "unknown").slice(0, 200);
  const url = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { parsedUrl = null; }

  if (parsedUrl && parsedUrl.protocol === "https:" && parsedUrl.hostname &&
      token && !/[\\r\\n"' ]/.test(token) && !/UPSTASH_REDIS_REST_(URL|TOKEN)=/.test(token)) {
    try {
      const response = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", `trimemo:ratelimit:keyed:${safeKey}`],
          ["PEXPIRE", `trimemo:ratelimit:keyed:${safeKey}`, windowMs, "NX"]
        ])
      });
      if (response.ok) {
        const data = await response.json().catch(() => []);
        const count = Number(data?.[0]?.result || 0);
        if (count > max) {
          const e = new Error("Trop de requêtes. Réessayez dans quelques minutes.");
          e.status = 429;
          throw e;
        }
        return;
      }
    } catch (e) {
      if (Number(e?.status) === 429) throw e;
      // Le service Redis étant auxiliaire, on utilise le limiteur local en cas d'indisponibilité.
    }
  }

  const now = Date.now();
  const hits = (keyedBuckets.get(safeKey) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const e = new Error("Trop de requêtes. Réessayez dans quelques minutes.");
    e.status = 429;
    throw e;
  }
  hits.push(now);
  keyedBuckets.set(safeKey, hits);
  if (keyedBuckets.size > 5000) keyedBuckets.clear();
}
