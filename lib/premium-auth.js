import crypto from "node:crypto";
import { requireOwner } from "./owner-auth.js";

const PREMIUM_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 jours : un mémoire se rédige sur plusieurs sessions

function getSecret() {
  return process.env.TRIMEMO_PREMIUM_AUTH_SECRET ||
    process.env.TRIMEMO_OWNER_AUTH_SECRET ||
    "";
}

function sign(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

export function projectFingerprint(project = {}) {
  const source = [
    String(project.projectId || project.project_id || "").trim(),
    String(project.sujet || project.subject || "").trim().toLowerCase(),
    String(project.formula || project.formule || "").trim().toUpperCase(),
    String(project.typeDoc || project.typeDocument || "").trim().toLowerCase(),
  ].join("|");
  return crypto.createHash("sha256").update(source).digest("hex");
}


export function paymentBinding(project = {}) {
  const secret = getSecret();
  if (!secret) throw new Error("TRIMEMO_PREMIUM_AUTH_SECRET ou secret administrateur manquant.");
  const projectId = String(project.projectId || project.project_id || "").trim();
  if (!projectId) throw Object.assign(new Error("Identifiant de projet manquant."), { status: 400 });
  return crypto.createHmac("sha256", secret).update(projectId + "|" + projectFingerprint(project)).digest("hex");
}

export function createPremiumToken(project = {}, paymentId = "") {
  const secret = getSecret();
  if (!secret) throw new Error("TRIMEMO_PREMIUM_AUTH_SECRET ou secret administrateur manquant.");

  const exp = Math.floor(Date.now() / 1000) + PREMIUM_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({
    role: "premium",
    sub: projectFingerprint(project),
    payment: String(paymentId || "").trim(),
    exp,
  })).toString("base64url");

  return payload + "." + sign(payload, secret);
}

function getBearerToken(req) {
  const value = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(value));
  if (match) return match[1].trim();

  return String(
    req.headers?.["x-trimemo-premium-token"] ||
    req.headers?.["X-Trimemo-Premium-Token"] ||
    ""
  ).trim();
}

export function requirePremium(req, project = {}) {
  const token = getBearerToken(req);
  const secret = getSecret();

  if (!secret || !token) {
    const error = new Error("Accès premium requis. Effectuez le paiement pour débloquer cette fonctionnalité.");
    error.status = 402;
    throw error;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    const error = new Error("Jeton premium invalide.");
    error.status = 401;
    throw error;
  }

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const error = new Error("Jeton premium invalide.");
    error.status = 401;
    throw error;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.role !== "premium" || !data.exp || Math.floor(Date.now() / 1000) >= Number(data.exp)) {
      const error = new Error("L'accès premium a expiré. Effectuez un nouveau déblocage.");
      error.status = 401;
      throw error;
    }

    if (data.sub !== projectFingerprint(project)) {
      const error = new Error("Le jeton premium ne correspond pas à ce projet.");
      error.status = 403;
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.status) throw error;
    const invalid = new Error("Jeton premium invalide.");
    invalid.status = 401;
    throw invalid;
  }
}

export function requirePremiumOrOwner(req, body = {}) {
  // Un jeton administrateur Bearer reste valide même si le frontend perd ownerMode.
  const authorization = String(req.headers?.authorization || req.headers?.Authorization || "");
  if (body?.ownerMode === true || /^Bearer\\s+/i.test(authorization)) {
    try {
      return { mode: "owner", owner: requireOwner(req) };
    } catch (ownerError) {
      if (body?.ownerMode === true) throw ownerError;
    }
  }
  return { mode: "premium", token: requirePremium(req, body?.project || body) };
}

export { PREMIUM_TTL_SECONDS };
