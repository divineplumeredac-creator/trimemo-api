function clientIp(req) {
  // Ne pas utiliser le premier X-Forwarded-For : l'appelant peut le falsifier.
  return String(
    req.headers?.["x-real-ip"] ||
    req.headers?.["x-vercel-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ).split(",")[0].trim().slice(0, 128);
}

function redisConfig() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== "https:" || !parsed.hostname || !token ||
      /[\\r\\n"' ]/.test(token) || /UPSTASH_REDIS_REST_(URL|TOKEN)=/.test(token)) {
    const error = new Error("Le limiteur partagé Redis est indisponible. Réessayez plus tard.");
    error.status = 503;
    throw error;
  }
  return { url: url.replace(/\\/$/, ""), token };
}

async function increment(key, windowMs) {
  const { url, token } = redisConfig();
  let response;
  try {
    response = await fetch(url + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, Math.max(1000, Math.round(Number(windowMs) || 1000)), "NX"]
      ]),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    const error = new Error("Le limiteur partagé Redis est temporairement inaccessible.");
    error.status = 503;
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Le limiteur partagé Redis est temporairement inaccessible.");
    error.status = 503;
    throw error;
  }
  const data = await response.json().catch(() => null);
  const count = Number(data?.[0]?.result);
  if (!Array.isArray(data) || data[0]?.error || !Number.isFinite(count) || count < 1) {
    const error = new Error("Réponse invalide du limiteur partagé Redis.");
    error.status = 503;
    throw error;
  }
  return count;
}

function rejectIfExceeded(count, max) {
  if (count <= Math.max(1, Math.round(Number(max) || 1))) return;
  const error = new Error("Trop de requêtes. Réessayez dans quelques minutes.");
  error.status = 429;
  throw error;
}

export async function rateLimit(req, key, max, windowMs) {
  const safeKey = String(key || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 100);
  const count = await increment("trimemo:ratelimit:" + safeKey + ":" + clientIp(req), windowMs);
  rejectIfExceeded(count, max);
}

export async function rateLimitByKey(key, max, windowMs) {
  const safeKey = String(key || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 180);
  const count = await increment("trimemo:ratelimit:keyed:" + safeKey, windowMs);
  rejectIfExceeded(count, max);
}
