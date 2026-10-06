export function getAllowedOrigin() {
  return String(process.env.TRIMEMO_FRONTEND_URL || '').trim().replace(/\/$/, '');
}

export function setCors(res, methods = 'POST, OPTIONS') {
  const origin = getAllowedOrigin();
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Trimemo-Premium-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

export function publicError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}
