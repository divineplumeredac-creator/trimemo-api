import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT_MASTER_V4, SYSTEM_PROMPT_VERSION } from '../lib/prompt-master.js';
import { TRIMEMO_MASTER_ACADEMIC_RULES } from '../lib/trimemo-academic-rules.js';
test('la charte de qualité est intégrée au prompt commun', () => {
  assert.equal(TRIMEMO_MASTER_ACADEMIC_RULES, SYSTEM_PROMPT_MASTER_V4);
  assert.match(SYSTEM_PROMPT_VERSION, /^4\./);
  for (const rule of ['CHARTE PERMANENTE DE QUALITÉ RÉDACTIONNELLE', 'énumérations systématiques par trois', 'experts anonymes', 'obligations de transparence', 'Ne simule aucune expérience', 'concordance citations-bibliographie', 'dans la même génération']) {
    assert.ok(TRIMEMO_MASTER_ACADEMIC_RULES.includes(rule), rule);
  }
});
