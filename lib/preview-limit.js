// A project of 30 pages or more has a 2,500-word preview. Shorter projects
// receive the same proportion; invalid or missing page counts fail closed.
export function previewWordLimit(pages) {
  const n = Number(pages);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(2500, Math.max(1, Math.round(2500 * n / 30)));
}
