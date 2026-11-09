export function getAllowedOrigin(req) {
  const configured = String(process.env.TRIMEMO_FRONTEND_URL || '').trim().replace(/\/$/, '');
  const requestOrigin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');

  if (!requestOrigin) return configured;
  if (requestOrigin === configured) return requestOrigin;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Trimemo-Premium-Token');
  res.setHeader(
    'Access-Control-Expose-Headers',
    [
      'X-Trimemo-Bibliography-Warning',
      'X-Trimemo-Bibliography-Count',
      'X-Trimemo-Bibliography-Missing-Links',
      'X-Trimemo-Citation-Warning',
      'X-Trimemo-Citation-Issue-Count',
      'X-Trimemo-Style-Control',
      'X-Trimemo-Style-Corrected-Fields',
      'X-Trimemo-Style-Warning',
      'X-Trimemo-Export-Attempt',
      'X-Trimemo-Export-Attempts-Remaining',
    ].join(', ')
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

export function publicError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}
