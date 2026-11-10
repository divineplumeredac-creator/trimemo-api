import test from 'node:test';
import assert from 'node:assert/strict';
import {hasMissingPartOpening} from '../lib/part-opening-audit.js';
const structure=['PARTIE I : Fondements','CHAPITRE 1 : Concepts'];
test('signale les titres de partie et de chapitre immédiatement consécutifs',()=>{assert.equal(hasMissingPartOpening('## PARTIE I : Fondements\n\n### CHAPITRE 1 : Concepts\n\nTexte.',structure),true)});
test('accepte un paragraphe entre les deux titres',()=>{assert.equal(hasMissingPartOpening('## PARTIE I : Fondements\n\nCette partie présente les notions clés.\n\n### CHAPITRE 1 : Concepts',structure),false)});
test('ne signale pas un bloc qui ne commence pas une partie',()=>{assert.equal(hasMissingPartOpening('### CHAPITRE 2 : Analyse\n\nTexte.',['CHAPITRE 2 : Analyse']),false)});
