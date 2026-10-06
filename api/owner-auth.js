import {
  ownerConfigured,
  checkOwnerCredentials,
  createOwnerToken,
  verifyOwnerToken,
  TTL_SECONDS,
} from "../lib/owner-auth.js";
import { rateLimit } from "../lib/rate-limit.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", String(process.env.TRIMEMO_FRONTEND_URL || ""));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, payload) {
  setCors(res);
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED", message: "Utilisez POST." });
  }

  if (!ownerConfigured()) {
    return json(res, 503, {
      ok: false,
      error: "OWNER_AUTH_NOT_CONFIGURED",
      message: "Définissez TRIMEMO_OWNER_EMAIL, TRIMEMO_OWNER_PASSWORD et TRIMEMO_OWNER_AUTH_SECRET.",
    });
  }

  const { action, email, password, token } = req.body || {};

  if (action === "login") {
    try {
      await rateLimit(req, "owner-login", 8, 15 * 60 * 1000);
    } catch (error) {
      return json(res, 429, { ok: false, error: "TOO_MANY_ATTEMPTS", message: error.message });
    }
    if (!checkOwnerCredentials(email, password)) {
      return json(res, 401, { ok: false, error: "INVALID_CREDENTIALS", message: "Identifiants invalides." });
    }
    const ownerEmail = String(process.env.TRIMEMO_OWNER_EMAIL).trim().toLowerCase();
    return json(res, 200, { ok: true, role: "owner", token: createOwnerToken(ownerEmail), expiresIn: TTL_SECONDS });
  }

  if (action === "verify") {
    const data = typeof token === "string" ? verifyOwnerToken(token) : null;
    if (!data) return json(res, 401, { ok: false, error: "INVALID_SESSION" });
    return json(res, 200, { ok: true, role: "owner", email: data.sub, exp: data.exp });
  }

  return json(res, 400, { ok: false, error: "INVALID_ACTION" });
}
