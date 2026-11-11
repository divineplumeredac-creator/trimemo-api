import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreviewWordLimit } from '../api/academic.js';
test('un aperçu composé de l’introduction est conservé intégralement',()=>{
  const preview={introduction:{content:'Introduction complète.'},chapterOne:{content:''},recoveryDigest:'abc123'};
  const actual=normalizePreviewWordLimit(preview);
  assert.equal(actual.introduction.content,'Introduction complète.');
  assert.equal(actual.chapterOne.content,'');
  assert.equal(actual.recoveryDigest,'abc123');
});
test('ne remplace pas une introduction manquante',()=>assert.throws(()=>normalizePreviewWordLimit({introduction:{content:''},chapterOne:{content:'Chapitre.'}})));
