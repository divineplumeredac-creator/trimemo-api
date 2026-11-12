import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceAcademicStyle } from '../lib/style-control.js';
import { auditCitationReferences } from '../lib/citation-audit.js';
import { sourceFootnotes } from '../lib/source-footnotes.js';
import { normalizeSources } from '../lib/normalize-sources.js';

test('les trois citations absentes constatées dans le mémoire sont détectées', () => {
  const content = '(Food and Nutrition Technical Assistance [FANTA], 2018). (Actualité ouest-africaine, s. d.). (fundsforNGOs, 2026).';
  const result = auditCitationReferences([{ content }], []);
  assert.deepEqual(result.unmatched.map(x => x.surname).sort(), ['fanta', 'fundsforngos', 'ouest africaine']);
});

test('une note utilise une source existante vérifiée et citée sans en inventer', () => {
  const sources = [{ author: 'UNICEF', year: '2020', title: 'Cadre nutritionnel', verified: true }, { author: 'FANTA', year: '2018', title: 'Notice indisponible', verified: false }];
  const notes = sourceFootnotes('Un constat (UNICEF, 2020) et une limite (FANTA, 2018).', sources);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /UNICEF.*2020.*Cadre nutritionnel/);
  assert.equal(sourceFootnotes('Pas de citation.', sources).length, 0);
});
test('une source au nom composé peut correspondre à sa citation', () => {
  const result = auditCitationReferences([{content:'(Actualité ouest-africaine, s. d.).'}], [{author:'Actualité ouest-africaine',year:'s. d.',title:'Rapport'}]);
  assert.equal(result.count,0);
});
test('deux éditions portant le même titre ne sont pas fusionnées entre elles', () => {
  const sources = normalizeSources([{author:'UNICEF',year:'2020',title:'Cadre'}, {author:'UNICEF',year:'2022',title:'Cadre'}]);
  assert.equal(sources.length,2);
});

const long = 'Ce résultat nécessite une analyse approfondie et précise des différentes conditions de production de données dans cette région et leurs effets sur les populations concernées.';
function responseFor(items, stop = 'end_turn') {
  return new Response(JSON.stringify({ id:'test', stop_reason:stop, content:[{type:'text',text:JSON.stringify({items})}],usage:{} }), {status:200});
}
test('le contrôle traite les paragraphes séparément sans perdre les séparations', async () => {
  const originalFetch = globalThis.fetch;
  const sizes = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const user = payload.messages[0].content[0].text;
    const fields = JSON.parse(user.slice(user.indexOf('[')));
    sizes.push(fields.length);
    return responseFor(fields.map(({id},i) => ({id, text:i ? 'La région exige une étude approfondie. Elle examine les conditions de production des données et leurs effets sur les populations.' : 'Ce résultat nécessite une analyse précise. Elle porte sur la production des données dans cette région et sur leurs effets.'})));
  };
  try {
    const result = await enforceAcademicStyle({content:long+'\n\n'+long}, {apiKey:'test-key', batchSize:4});
    assert.equal(sizes[0],2);
    assert.equal(result.value.content,'Ce résultat nécessite une analyse précise. Elle porte sur la production des données dans cette région et sur leurs effets.\n\nLa région exige une étude approfondie. Elle examine les conditions de production des données et leurs effets sur les populations.');
  } finally { globalThis.fetch = originalFetch; }
});
test('un chiffre supprimé par une révision stylistique est refusé', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const user=JSON.parse(options.body).messages[0].content[0].text;
    const fields=JSON.parse(user.slice(user.indexOf('[')));
    return responseFor(fields.map(({id})=>({id,text:'Le résultat exige une analyse précise.'})));
  };
  try { await assert.rejects(enforceAcademicStyle({content:long+' En 2024, la proportion atteint 20 %.'},{apiKey:'test-key'}), /citation ou une donnée/); }
  finally { globalThis.fetch=originalFetch; }
});
test('une réponse tronquée même au format JSON valide est retentée', async () => {
  const originalFetch=globalThis.fetch; let calls=0; const limits=[];
  globalThis.fetch=async (_url,options)=>{
    calls++;
    const request=JSON.parse(options.body);
    limits.push(request.max_tokens);
    assert.deepEqual(request.thinking,{type:'disabled'});
    assert.equal(request.output_config.format.type,'json_schema');
    const user=request.messages[0].content[0].text;
    const fields=JSON.parse(user.slice(user.indexOf('[')));
    return responseFor(fields.map(({id})=>({id,text:'Ce résultat nécessite une analyse précise. Elle porte sur la production des données dans cette région et sur leurs effets.'})), calls===1?'max_tokens':'end_turn');
  };
  try { const result=await enforceAcademicStyle({content:long},{apiKey:'test-key'});assert.equal(result.value.content,'Ce résultat nécessite une analyse précise. Elle porte sur la production des données dans cette région et sur leurs effets.');assert.equal(calls,2);assert.ok(limits[1]>limits[0]); }
  finally {globalThis.fetch=originalFetch;}
});
