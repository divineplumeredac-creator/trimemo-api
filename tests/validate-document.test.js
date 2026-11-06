import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../lib/validate-document.js';

const validInput = {
  project: { sujet: 'La santé mentale des employés' },
  problematic: { question: 'Quels facteurs influencent la santé mentale des employés ?' },
  plan: { parts: [{ title: 'Fondements', chapters: [{ title: 'Cadre conceptuel', sections: [{ title: 'Définitions', subsections: [] }] }] }] },
  blocks: [
    { id: 'intro', kind: 'introduction', blockOrder: 1, title: 'Introduction générale', content: 'A'.repeat(300), structure: ['Introduction générale'] },
    { id: 'body', kind: 'chapter', blockOrder: 2, title: 'Cadre conceptuel', content: 'B'.repeat(500), structure: ['Fondements', 'Cadre conceptuel', 'Définitions'] },
    { id: 'conclusion', kind: 'conclusion', blockOrder: 3, title: 'Conclusion générale', content: 'C'.repeat(250), structure: ['Conclusion générale'] }
  ]
};

test('accepts a complete document with ordered blocks and known headings', () => {
  const result = validateDocument(validInput);
  assert.equal(result.blocks.length, 3);
});

test('rejects empty writing blocks', () => {
  assert.throws(() => validateDocument({ ...validInput, blocks: [...validInput.blocks, { id: 'empty', blockOrder: 4, content: '' }] }), /ne peut pas être compilé/);
});

test('rejects duplicate block order', () => {
  const blocks = validInput.blocks.map((block) => ({ ...block }));
  blocks[1].blockOrder = 1;
  assert.throws(() => validateDocument({ ...validInput, blocks }), /ne peut pas être compilé/);
});

test('rejects structural headings not present in the selected plan', () => {
  const blocks = validInput.blocks.map((block) => ({ ...block, structure: [...block.structure] }));
  blocks[1].structure.push('Chapitre fantôme');
  assert.throws(() => validateDocument({ ...validInput, blocks }), /ne peut pas être compilé/);
});


test('accepts planned subsections and internal titles with numbered labels', () => {
  const input = structuredClone(validInput);
  input.plan.parts[0].chapters[0].sections[0].subsections = [{
    title: 'Cadre juridique',
    internalTitles: [{ title: 'Les obligations de prévention' }]
  }];
  input.blocks[1].structure.push('1.1.1 Cadre juridique', '1.1.1.1 Les obligations de prévention');
  assert.doesNotThrow(() => validateDocument(input));
});

test('rejects a subsection that is not part of the selected plan', () => {
  const input = structuredClone(validInput);
  input.blocks[1].structure.push('1.1.1 Sous-section inconnue');
  assert.throws(() => validateDocument(input), /rubrique absente du plan validé/);
});
