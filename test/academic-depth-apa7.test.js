import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSources, sourceToApa, sourceToApaParts } from '../lib/normalize-sources.js';
import { buildBibliography } from '../lib/build-bibliography.js';
import { verifySources } from '../lib/verify-sources.js';

test('APA 7 : revue, volume, numéro, pagination et DOI sans point final', () => {
  const entry = sourceToApa({author:'Ryan, R. M., & Deci, E. L.',year:'2000',title:'Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being',type:'article',journal:'American Psychologist',volume:'55',issue:'1',pages:'68-78',doi:'10.1037/0003-066X.55.1.68'});
  assert.match(entry,/American Psychologist, 55\(1\), 68–78\./);
  assert.ok(entry.endsWith('https://doi.org/10.1037/0003-066X.55.1.68'));
  assert.ok(!entry.endsWith('.'));
  const italic = sourceToApaParts({type:'article',title:'Theory',author:'R.',year:'2000',journal:'Journal',volume:'12',pages:'10-20'});
  assert.deepEqual(italic.filter(part=>part.italics).map(part=>part.text),['Journal',', 12']);
});

test('APA 7 : thèse et ouvrage gardent les éditeurs et les métadonnées authentiques', () => {
  const thesis = sourceToApa({author:'Cannon, M.',year:'2015',title:'Employee recognition: Understanding the construct, its measurement and its relationship to employee outcomes',type:'thesis',institution:'Saint Mary’s University',url:'https://example.org/thesis.pdf'});
  assert.match(thesis,/\[Thèse ou mémoire universitaire, Saint Mary’s University\]/);
  assert.ok(thesis.endsWith('https://example.org/thesis.pdf'));
  const book = sourceToApa({author:'Auteur, A.',year:'2020',title:'Ouvrage scientifique',type:'book',publisher:'Presses universitaires'});
  assert.match(book,/Ouvrage scientifique\. Presses universitaires\./);
});

test('les sources répétées conservent les métadonnées les plus complètes', () => {
  const sources=normalizeSources([
    {author:'Ryan',year:'2000',title:'Theory',doi:'10.1000/abc'},
    {author:'Ryan',year:'2000',title:'Theory',doi:'10.1000/abc',journal:'Revue',volume:'9',issue:'2',pages:'33-44'},
  ]);
  assert.equal(sources.length,1);
  assert.equal(sources[0].volume,'9');
  const bib=buildBibliography({blocks:[{content:'Ryan (2000) montre ce résultat.',sources}]});
  assert.match(bib.entries[0],/Revue, 9\(2\), 33–44/);
});

test('la vérification DOI récupère les métadonnées Crossref existantes sans nouveau passage IA', async () => {
  const previous=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async url => {
    requests++;
    assert.match(String(url),/api\.crossref\.org\/works/);
    return Response.json({message:{title:['An exact article title'],author:[{family:'Martin',given:'Alice'}],'container-title':['Academic Review'],type:'journal-article',volume:'16',issue:'3',page:'101-117'}});
  };
  try {
    const [result]=await verifySources([{author:'Martin',year:'2024',title:'An exact article title',doi:'10.1234/test'}]);
    assert.equal(result.verified,true);
    assert.equal(result.journal,'Academic Review');
    assert.equal(result.volume,'16');
    assert.equal(result.pages,'101-117');
    assert.equal(requests,1);
  } finally { globalThis.fetch=previous; }
});

test('aucune métadonnée bibliographique absente ne doit être inventée', () => {
  const entry=sourceToApa({author:'Auteur',year:'2025',title:'Travail documenté',type:'article',url:'https://example.org/publication'});
  assert.doesNotMatch(entry,/\d+\(\d+\)/);
  assert.ok(entry.endsWith('https://example.org/publication'));
});
