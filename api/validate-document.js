import { normalizePlan } from './lib/normalize-plan.js';
import { normalizeBlocks } from './lib/normalize-block.js';
import { DocumentValidationError } from './lib/document-errors.js';

export function validateDocument(input = {}) {
  const issues = [];
  const plan = normalizePlan(input.plan || {});
  const blocks = normalizeBlocks(input.blocks || []);

  if (!String(input.project?.sujet || input.project?.subject || '').trim()) {
    issues.push('Le sujet est absent.');
  }
  if (
    !String(
      input.problematic?.question ||
      input.problematic?.text ||
      input.problematic?.content ||
      ''
    ).trim()
  ) {
    issues.push('La problématique est absente.');
  }
  if (!plan.parts.length) {
    issues.push('Le plan retenu ne contient aucune partie.');
  }

  for (const part of plan.parts) {
    if (!part.chapters.length) {
      issues.push(`La partie ${part.number} ne contient aucun chapitre.`);
    }
    for (const chapter of part.chapters) {
      if (!chapter.sections.length) {
        issues.push(
          `Le chapitre ${chapter.title} ne contient aucune section.`
        );
      }
    }
  }

  if (!blocks.length) {
    issues.push('Aucun bloc de rédaction n’a été fourni.');
  }

  if (issues.length) {
    throw new DocumentValidationError(
      'Le document ne peut pas être compilé.',
      issues
    );
  }

  return { ...input, plan, blocks };
}

export default validateDocument;
