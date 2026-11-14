/** Safe, deterministic normalization of a document's visible subject.
 * Never invent a replacement topic or change a legitimate specialization. */
export function normalizeAcademicTitle(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/\bcnflits\b/giu, 'conflits')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
