import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCitationReferences } from '../lib/citation-audit.js';
import { buildBibliography } from '../lib/build-bibliography.js';

test('Eisenhardt 1997a est distinct de Eisenhardt 1997b', () => {
  const s=[{author:'Eisenhardt, K. M.',year:'1997a',title:'Étude A'}];
  const b=[{content:'Eisenhardt et al. (1997a) le montrent ; Eisenhardt et al. (1997b) le discutent.'}];
  assert.deepEqual(auditCitationReferences(b,s).unmatched.map(x=>x.year),['1997b']);
});
test('une bibliographie réunit les métadonnées des blocs et du dossier, sans sources sans citation', () => {
  const paper={author:'De Wit',year:'2012',title:'Types de conflits',verified:true};
  const main={author:'Rahim',year:'2002',title:'Gestion du conflit',verified:true};
  const other={author:'Sans citation',year:'2021',title:'Non utilisé'};
  const bib=buildBibliography({blocks:[{content:'De Wit (2012) et Rahim (2002) débattent.',sources:[main]}],papers:[paper,main,other]});
  assert.equal(bib.count,2);
  assert.match(bib.entries.join(' '),/De Wit/);
  assert.doesNotMatch(bib.entries.join(' '),/Sans citation/);
});
test('la bibliographie convertit les entités HTML dans les titres', () => {
  const bib=buildBibliography({blocks:[{content:'Éditeur (2026).',sources:[{author:'Éditeur',year:'2026',title:'Asia &amp; Management',venue:'Science &amp; Culture'}]}]});
  assert.match(bib.entries[0],/Asia & Management/);
  assert.doesNotMatch(bib.entries[0],/&amp;/);
});
