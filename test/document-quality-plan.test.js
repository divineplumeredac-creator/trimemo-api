import test from 'node:test';
import assert from 'node:assert/strict';
import { academicStructureProfile } from '../lib/document-profile.js';
import { unexpectedGeographicScope } from '../lib/geographic-scope.js';
test('une dissertation courte ne reçoit pas automatiquement 4 chapitres',()=>{
 const p=academicStructureProfile({typeDoc:'Dissertation',pages:13,niveau:'Licence 1'});
 assert.equal(p.partMin,2); assert.equal(p.chapterMin,1); assert.equal(p.chapterMax,1);
});
test('les mémoires longs gardent une architecture de mémoire',()=>{
 const p=academicStructureProfile({typeDoc:'Mémoire',pages:75});
 assert.equal(p.chapterMin,2); assert.equal(p.partMax,3);
});
test('un article scientifique ne reçoit pas un plan de mémoire',()=>{
 const p=academicStructureProfile({typeDoc:'Article scientifique',pages:20});
 assert.equal(p.partMax,1); assert.equal(p.chapterMax,1);
});
test('une région absente du dossier ne doit pas être imposée',()=>{
 assert.deepEqual(unexpectedGeographicScope('Stratégie des entreprises en Asie',{sujet:'Gestion des conflits'}),['asie']);
 assert.deepEqual(unexpectedGeographicScope('Gestion des conflits en Asie',{sujet:'Gestion des conflits en Asie'}),[]);
 assert.deepEqual(unexpectedGeographicScope('Gestion des conflits en Asie',{sujet:'Gestion des conflits'},'Analyse en Asie'),[]);
});
