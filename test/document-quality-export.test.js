import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAcademicTitle } from '../lib/document-title.js';
import { buildBibliography } from '../lib/build-bibliography.js';
import { auditCitationReferences } from '../lib/citation-audit.js';
import { readFileSync } from 'node:fs';
test('une faute connue du sujet ne se propage plus dans en-tête, titre et fichier',()=>{
 assert.equal(normalizeAcademicTitle('Gestion des cnflits'),'Gestion des conflits');
});
test('toute citation manquante est signalée avant l’export',()=>{
 const blocks=[{content:'Rahim (2001) et Rahim (2002) sont distingués.'}];
 const bibliography=buildBibliography({blocks,papers:[{author:'Rahim',year:'2002',title:'Gestion des conflits'}]});
 assert.deepEqual(auditCitationReferences(blocks,bibliography.sources).unmatched.map(x=>x.year),['2001']);
});
test('le moteur n’ajoute plus automatiquement une note bibliographique en absence de note explicative',()=>{
 const exportSource=readFileSync(new URL('../api/export.js',import.meta.url),'utf8');
 assert.doesNotMatch(exportSource,/sourceFootnotes\(block\.content/);
 assert.match(exportSource,/if \(citationAudit\.count\)/);
 assert.ok(exportSource.indexOf('if (citationAudit.count)') < exportSource.indexOf('claimOrderExportAttempt(access.token, body.project || body)'));
});
