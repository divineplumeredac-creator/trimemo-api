import { normalizePlan } from './normalize-plan.js';
import { normalizeBlocks } from './normalize-block.js';
import { DocumentValidationError } from './document-errors.js';

function clean(value) { return String(value ?? '').trim(); }
function flattenPlan(plan) {
  return (plan.parts || []).flatMap((part) =>
    (part.chapters || []).flatMap((chapter) =>
      (chapter.sections || []).map((section) => ({
        part: clean(part.title),
        chapter: clean(chapter.title),
        section: clean(section.title),
      }))
    )
  );
}
function normalizeHeadingLabel(value) {
  return clean(value)
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/^(partie|part|chapitre|section|sous-section|titre interne)\\s+[ivxlcdm0-9.]+\\s*[:.)-]?\\s*/i, '')
    .replace(/^\\d+(?:\\.\\d+){0,5}\\s*[:.)-]?\\s*/, '')
    .replace(/\\s+/g, ' ');
}

export function validateDocument(input = {}) {
  const issues = [];
  const plan = normalizePlan(input.plan || {});
  const blocks = normalizeBlocks(input.blocks || []);
  const project = input.project || {};
  if (!clean(project.sujet || project.subject)) issues.push('Le sujet est absent.');
  if (!clean(input.problematic?.question || input.problematic?.text || input.problematic?.content)) issues.push('La problématique est absente.');
  if (!plan.parts.length) issues.push('Le plan retenu ne contient aucune partie.');

  const planned = flattenPlan(plan);
  for (const part of plan.parts) {
    if (!part.chapters.length) issues.push(`La partie ${part.number} ne contient aucun chapitre.`);
    for (const chapter of part.chapters) {
      if (!chapter.sections.length) issues.push(`Le chapitre ${chapter.title} ne contient aucune section.`);
    }
  }
  if (!blocks.length) issues.push('Aucun bloc de rédaction n’a été fourni.');

  const ordered = [...blocks].sort((a, b) => a.blockOrder - b.blockOrder);
  const duplicateOrders = ordered.filter((block, index) => index > 0 && block.blockOrder === ordered[index - 1].blockOrder);
  if (duplicateOrders.length) issues.push('Plusieurs blocs partagent le même ordre de rédaction.');
  const empty = ordered.filter((block) => !clean(block.content));
  if (empty.length) issues.push(`${empty.length} bloc(s) de rédaction sont vides.`);

  const intro = ordered.filter((block) => block.kind === 'introduction');
  const conclusion = ordered.filter((block) => block.kind === 'conclusion');
  if (intro.length && !intro.some((block) => clean(block.content).length >= 250)) {
    issues.push('L’introduction existe, mais son contenu est trop court pour être exporté comme introduction générale.');
  }
  if (conclusion.length && !conclusion.some((block) => clean(block.content).length >= 180)) {
    issues.push('La conclusion existe, mais son contenu est trop court pour être exporté comme conclusion générale.');
  }

  // Contrôle de rattachement : si les blocs déclarent une structure, chaque référence
  // doit correspondre à un élément du plan retenu. Les anciens blocs sans métadonnées
  // restent acceptés pour préserver les projets historiques.
  const plannedTitles = planned.flatMap((item) => [item.part, item.chapter, item.section]).filter(Boolean);
  for (const block of ordered) {
    if (!block.structure.length) continue;
    const unknown = block.structure.filter((label) => {
      const normalized = normalizeHeadingLabel(label);
      return !plannedTitles.some((title) => normalizeHeadingLabel(title) === normalized) &&
        !/^(introduction générale|conclusion générale)$/i.test(normalized);
    });
    if (unknown.length) issues.push(`Le bloc « ${block.title || block.id} » contient une rubrique absente du plan validé : ${unknown[0]}.`);
  }

  if (issues.length) throw new DocumentValidationError('Le document ne peut pas être compilé.', issues);
  return { ...input, plan, blocks };
}
export default validateDocument;
