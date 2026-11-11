import test from 'node:test';
import assert from 'node:assert/strict';
import { previewWordLimit } from '../lib/preview-limit.js';
test('la limite est proportionnelle et plafonnée',()=>{for(const [pages,expected] of [[1,83],[10,833],[15,1250],[29,2417],[30,2500],[45,2500]]) assert.equal(previewWordLimit(pages),expected)});
test('les valeurs absentes ou invalides ne créent pas d’aperçu',()=>{for(const pages of [undefined,0,-1,'abc']) assert.equal(previewWordLimit(pages),0)});
