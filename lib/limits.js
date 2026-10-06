// Limites serveur : le prix payé borne le volume généré (évite les abus de coût OpenAI).
const MAX_PAGES = { LICENCE: 45, MASTER: 80, DOCTORAT: 100 };
export function clampPages(project = {}, fallback = 30) {
  const formula = String(project.formula || project.formule || "").toUpperCase();
  const max = MAX_PAGES[formula] || 80;
  const requested = Number(project.pages) || fallback;
  return Math.min(Math.max(10, Math.round(requested)), max);
}
// Les fonctions Vercel refusent les corps > 4,5 Mo : on échoue proprement avant OpenAI.
export function assertFilesSize(files, maxBytes = 3.2 * 1024 * 1024) {
  const total = (Array.isArray(files) ? files : []).reduce((s, f) => s + String(f?.content || "").length * 0.75, 0);
  if (total > maxBytes) {
    const e = new Error("Les documents joints dépassent la taille autorisée (3 Mo au total).");
    e.status = 413;
    throw e;
  }
}
