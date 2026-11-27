import test from 'node:test';
import assert from 'node:assert/strict';
import { targetedSpec, buildTargetedPlan } from '../lib/targeted-writing.js';
const project={projectId:'p1',writingMode:'targeted_writing',targetedParts:['Revue de littérature'],pages:6};
test('le mode intégral conserve son comportement',()=>assert.equal(targetedSpec({pages:10}),null));
test('la structure ciblée conserve le volume et ne réserve pas de pages aux unités non demandées',()=>{const p=buildTargetedPlan(project,[{sections:[{title:'Travaux empiriques'},{title:'Limites de la littérature'}]}]);assert.equal(p.totalWords,1800);assert.equal(p.parts.length,1);assert.equal(p.introductionGeneral.wordCount,0);assert.equal(p.conclusionGeneral.wordCount,0);assert.equal(p.parts[0].chapters[0].sections.length,2);});
test('les résultats ne sont pas demandés sans information de recherche',()=>assert.throws(()=>targetedSpec({...project,targetedParts:['Analyse des résultats']}),/informations de recherche/));
test('le volume doit couvrir les parties demandées',()=>assert.throws(()=>targetedSpec({...project,pages:1,targetedParts:['Revue de littérature','Cadre théorique']}),/une page/));
