import { normalizePlan } from './normalize-plan.js';
import { normalizeBlocks } from './normalize-block.js';
import { buildBibliography } from './build-bibliography.js';
import validateDocument from './validate-document.js';

export function compileDocument(input = {}) {
  const validated = validateDocument(input);
  const plan = normalizePlan(validated.plan);
  const blocks = normalizeBlocks(validated.blocks);
  const bibliography = buildBibliography({ ...validated, blocks });
  return { project: validated.project || {}, problematic: validated.problematic || {}, plan, blocks, bibliography, compiledAt: new Date().toISOString() };
}
export default compileDocument;
