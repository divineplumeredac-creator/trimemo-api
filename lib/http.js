const PRODUCTION_ORIGINS = new Set(['https://trimemo-redac.company', 'https://trimemo-frontend.vercel.app']);

export function getFrontendOrigin(req) {
  const configured = String(process.env.TRIMEMO_FRONTEND_URL || 'https://trimemo-frontend.vercel.app').trim().replace(/\/$/, '');
  const requestOrigin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  // Seuls les domaines de production explicites peuvent déterminer un retour
  // de paiement ou un lien de compte ; les autres utilisent l'URL configurée.
  return PRODUCTION_ORIGINS.has(requestOrigin) ? requestOrigin : configured;
}

export function getAllowedOrigin(req) {
  const configured = String(process.env.TRIMEMO_FRONTEND_URL || '').trim().replace(/\/$/, '');
  const requestOrigin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');

  if (!requestOrigin) return configured;
  if (requestOrigin === configured || PRODUCTION_ORIGINS.has(requestOrigin)) return requestOrigin;

  try {
    const url = new URL(requestOrigin);
    const hostname = url.hostname.toLowerCase();
    const isTrimemoVercelDeployment =
      url.protocol === 'https:' &&
      hostname.endsWith('.vercel.app') &&
      hostname.startsWith('trimemo-frontend-');

    if (isTrimemoVercelDeployment) return requestOrigin;
  } catch {}

  return configured;
}

export function setCors(res, req, methods = 'POST, OPTIONS') {
  const origin = getAllowedOrigin(req);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Trimemo-Premium-Token, X-Trimemo-Client-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

export function publicError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}
