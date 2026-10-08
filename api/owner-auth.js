import {
  ownerConfigured,
  checkOwnerCredentials,
  createOwnerToken,
  verifyOwnerToken,
  TTL_SECONDS,
} from "../lib/owner-auth.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getAllowedOrigin } from "../lib/http.js";

function setCors(res, req) {
  const origin = getAllowedOrigin(req);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, payload, req) {
  setCors(res, req);
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED", message: "Utilisez POST." }, req);
  }

  if (!ownerConfigured()) {
    return json(res, 503, {
      ok: false,
      error: "OWNER_AUTH_NOT_CONFIGURED",
      message: "Définissez TRIMEMO_OWNER_EMAIL, TRIMEMO_OWNER_PASSWORD et TRIMEMO_OWNER_AUTH_SECRET.",
    }, req);
  }

  const { action, email, password, token } = req.body || {};

  if (action === "login") {
    try {
      await rateLimit(req, "owner-login", 8, 15 * 60 * 1000);
    } catch (error) {
      return json(res, 429, { ok: false, error: "TOO_MANY_ATTEMPTS", message: error.message }, req);
    }
    if (!checkOwnerCredentials(email, password)) {
      return json(res, 401, { ok: false, error: "INVALID_CREDENTIALS", message: "Identifiants invalides." }, req);
    }
    const ownerEmail = String(process.env.TRIMEMO_OWNER_EMAIL).trim().toLowerCase();
    return json(res, 200, { ok: true, role: "owner", token: createOwnerToken(ownerEmail), expiresIn: TTL_SECONDS }, req);
  }

  if (action === "verify") {
    const data = typeof token === "string" ? verifyOwnerToken(token) : null;
    if (!data) return json(res, 401, { ok: false, error: "INVALID_SESSION" }, req);
    return json(res, 200, { ok: true, role: "owner", email: data.sub, exp: data.exp }, req);
  }

  return json(res, 400, { ok: false, error: "INVALID_ACTION" }, req);
}
