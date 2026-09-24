import crypto from "node:crypto";

const TTL_SECONDS = 12 * 60 * 60;

function getSecret() {
  return process.env.TRIMEMO_OWNER_AUTH_SECRET || process.env.TRIMEMO_OWNER_PASSWORD || "";
}

function sign(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function verifyOwnerToken(token) {
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
  const match = /^Bearer\\s+(.+)$/i.exec(String(value));
  return match ? match[1].trim() : "";
}

export function requireOwner(req) {
  const token = getBearerToken(req);
  const data = verifyOwnerToken(token);
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
