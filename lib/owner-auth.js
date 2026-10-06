import crypto from "node:crypto";

const TTL_SECONDS = 12 * 60 * 60;

// Un secret dédié est OBLIGATOIRE : ne jamais signer les jetons avec le mot de passe.
function getSecret() {
  return process.env.TRIMEMO_OWNER_AUTH_SECRET || "";
}

function sign(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function ownerConfigured() {
  return Boolean(
    (process.env.TRIMEMO_OWNER_EMAIL || "").trim() &&
    process.env.TRIMEMO_OWNER_PASSWORD &&
    getSecret()
  );
}

export function checkOwnerCredentials(email, password) {
  const ownerEmail = (process.env.TRIMEMO_OWNER_EMAIL || "").trim().toLowerCase();
  const validEmail = typeof email === "string" && safeEqual(email.trim().toLowerCase(), ownerEmail);
  const validPassword = typeof password === "string" && safeEqual(password, process.env.TRIMEMO_OWNER_PASSWORD || "");
  return validEmail && validPassword;
}

export function createOwnerToken(email) {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ sub: email.toLowerCase(), role: "owner", exp })).toString("base64url");
  return payload + "." + sign(payload, secret);
}

export function verifyOwnerToken(token) {
  const secret = getSecret();
  if (!secret || typeof token !== "string") return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const ownerEmail = (process.env.TRIMEMO_OWNER_EMAIL || "").trim().toLowerCase();
    if (data.role !== "owner" || !data.sub || data.sub !== ownerEmail || !data.exp) return null;
    if (Math.floor(Date.now() / 1000) >= Number(data.exp)) return null;
    return data;
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const value = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(value));
  return match ? match[1].trim() : "";
}

export function requireOwner(req) {
  const data = verifyOwnerToken(getBearerToken(req));
  if (!data) {
    const error = new Error("Session administrateur invalide ou expirée.");
    error.status = 401;
    throw error;
  }
  return data;
}

export function isOwnerRequest(body) {
  return body?.ownerMode === true;
}

export { TTL_SECONDS };
