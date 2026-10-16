import {
  ownerConfigured,
  checkOwnerCredentials,
  createOwnerToken,
  verifyOwnerToken,
  TTL_SECONDS,
} from "../lib/owner-auth.js";
import { rateLimit } from "../lib/rate-limit.js";
import { setCors } from "../lib/http.js";

function applyCors(res, req) { setCors(res, req, "POST, OPTIONS"); }

function json(res, status, payload, req) {
  applyCors(res, req);
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  applyCors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED", message: "Utilisez POST." }, req);
  }

  if (!ownerConfigured()) {
    return json(res, 503, {
      ok: false,
      error: "OWNER_AUTH_NOT_CONFIGURED",
      message: "Définissez TRIMEMO_OWNER_EMAIL, TRIMEMO_OWNER_PASSWORD_HASH (ou le mot de passe de migration) et TRIMEMO_OWNER_AUTH_SECRET.",
    }, req);
  }

  const { action, email, password, token } = req.body || {};

  if (action === "login") {
    try {
      await rateLimit(req, "owner-login", 8, 15 * 60 * 1000);
    } catch (error) {
      return json(res, Number(error?.status) === 503 ? 503 : 429, { ok: false, error: Number(error?.status) === 503 ? "RATE_LIMIT_UNAVAILABLE" : "TOO_MANY_ATTEMPTS", message: error.message }, req);
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
