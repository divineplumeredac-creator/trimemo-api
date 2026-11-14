import { normalizePlan } from './normalize-plan.js';
import { normalizeBlocks } from './normalize-block.js';
import { buildBibliography } from './build-bibliography.js';
import validateDocument from './validate-document.js';
import { normalizeAcademicTitle } from './document-title.js';

export function compileDocument(input = {}) {
  const validated = validateDocument(input);
  const plan = normalizePlan(validated.plan);
  const blocks = normalizeBlocks(validated.blocks);
  const bibliography = buildBibliography({ ...validated, blocks });
  const project = { ...(validated.project || {}) };
  const rawTitle = project.sujet || project.subject || '';
  if (rawTitle) {
    const normalizedTitle = normalizeAcademicTitle(rawTitle);
    if (project.sujet) project.sujet = normalizedTitle;
    else project.subject = normalizedTitle;
  }
  return { project, problematic: validated.problematic || {}, plan, blocks, bibliography, compiledAt: new Date().toISOString() };
}
export default compileDocument;
