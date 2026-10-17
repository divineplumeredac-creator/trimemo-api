const TRIMEMO_PREVIEW_FRONTEND_ORIGIN = "https://trimemo-frontend-git-audit-securit-4f605f-divineplumeredac-4026.vercel.app";

export function getAllowedOrigin(req) {
  const configured = String(process.env.TRIMEMO_FRONTEND_URL || "").trim().replace(/\/$/, "");
  const extras = String(process.env.TRIMEMO_ALLOWED_ORIGINS || "")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  const allowed = new Set([configured, ...extras].filter(Boolean));
  const requestOrigin = String(req?.headers?.origin || "").trim().replace(/\/$/, "");

  if (!requestOrigin) return configured;
  // Explicitly allow only the known test frontend on Preview deployments.
  // Production continues to rely solely on its configured origins.
  if (process.env.VERCEL_ENV === "preview" && requestOrigin === TRIMEMO_PREVIEW_FRONTEND_ORIGIN) {
    return requestOrigin;
  }
  return allowed.has(requestOrigin) ? requestOrigin : "";
}

export function setCors(res, req, methods = "POST, OPTIONS") {
  const origin = getAllowedOrigin(req);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

export function publicError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}
