import test from 'node:test';
import assert from 'node:assert/strict';
import { hasClearlyIncompleteEnding } from '../lib/incomplete-ending.js';

test('signale le fragment observé sans modifier le texte', () => {
  assert.equal(hasClearlyIncompleteEnding('Cette traduction transforme une remarque en exigence interne. Un'), true);
});
test('accepte une phrase terminée', () => {
  assert.equal(hasClearlyIncompleteEnding('Cette traduction transforme une remarque en exigence interne.'), false);
});
