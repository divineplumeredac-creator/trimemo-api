export class DocumentValidationError extends Error {
  constructor(message, details = []) { super(message); this.name = 'DocumentValidationError'; this.status = 422; this.details = details; }
}
export function errorResponse(res, error) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({ error: error?.message || 'Erreur interne.', details: Array.isArray(error?.details) ? error.details : undefined });
}
