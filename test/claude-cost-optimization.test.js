import test from 'node:test';
import assert from 'node:assert/strict';
import { callClaude, claudeFetch } from '../lib/claude-client.js';
import { cachedWritingPrompt, needsWritingSearch, writingCacheTtl } from '../lib/writing-context.js';
import { usageBreakdown, estimateUsageCost } from '../lib/usage-accounting.js';
const response = () => Response.json({id:'synthetic',stop_reason:'end_turn',content:[{type:'text',text:'{"content":"Texte."}'}],usage:{input_tokens:100,output_tokens:80,cache_creation_input_tokens:40,cache_read_input_tokens:400,cache_creation:{ephemeral_5m_input_tokens:10,ephemeral_1h_input_tokens:30},server_tool_use:{web_search_requests:2}}});
test('le cache préserve chaque caractère des documents et du plan quand seul le bloc change',async()=>{
 const before=globalThis.fetch,requests=[];
 globalThis.fetch=async(_url,opts)=>{requests.push(JSON.parse(opts.body));return response();};
 try {
  const docs='Guide intégral éà漢字 '+ 'Texte documentaire. '.repeat(3000)+'\n\n';
  for(const block of ['Chapitre 1','Chapitre 2']){
   const text=docs+'SUJET : Sujet\nPLAN : {"parts":["A","B"]}\n\nBLOC À RÉDIGER : '+block+'\nHistorique complet.';
   const parts=cachedWritingPrompt(text,docs);
   assert.equal(parts.map(p=>p.text).join(''),text);
   const out=await callClaude({apiKey:'fake',system:'Règles stables',user:parts,cacheTtl:'1h',webSearch:true});
   const adapted=await out.json();
   assert.equal(adapted.usage.input_tokens,540);
   assert.equal(adapted.usage.uncached_input_tokens,100);
   assert.equal(adapted.usage.cache_read_input_tokens,400);
   assert.equal(adapted.usage.server_tool_use.web_search_requests,2);
  }
  assert.deepEqual(requests[0].system,requests[1].system);
  assert.deepEqual(requests[0].messages[0].content.slice(0,2),requests[1].messages[0].content.slice(0,2));
  assert.equal(requests[0].system[0].cache_control.ttl,'1h');
  assert.equal(requests[0].messages[0].content[0].cache_control.ttl,'1h');
  assert.notEqual(requests[0].messages[0].content.at(-1).text,requests[1].messages[0].content.at(-1).text);
  assert.equal(requests[0].thinking,undefined);
 } finally {globalThis.fetch=before;}
});
test('la correction seule désactive la réflexion et utilise le schéma natif sans casser le cache',async()=>{
 const before=globalThis.fetch;let request;
 globalThis.fetch=async(_url,opts)=>{request=JSON.parse(opts.body);return response();};
 try {
  const schema={type:'object',properties:{items:{type:'array',items:{type:'string'}}},required:['items'],additionalProperties:false};
  await claudeFetch('https://api.openai.com/v1/responses',{headers:{Authorization:'Bearer fake'},body:JSON.stringify({model:'claude-haiku-5-5',thinking:{type:'disabled'},native_json_schema:true,cache_ttl:'1h',input:[{role:'system',content:'Règles'},{role:'user',content:[{type:'input_text',text:'Documents intégraux',cache_control:{type:'ephemeral',ttl:'1h'}},{type:'input_text',text:'Consigne'}]}],text:{format:{type:'json_schema',schema}}})});
  assert.deepEqual(request.thinking,{type:'disabled'});
  assert.deepEqual(request.output_config.format.schema,schema);
  assert.equal(request.messages[0].content[0].cache_control.ttl,'1h');
  assert.equal(request.system[0].cache_control.ttl,'1h');
 } finally {globalThis.fetch=before;}
});
test('le coût sépare entrée, écritures de cache, relectures, sortie et recherches',()=>{
 const m=usageBreakdown({provider:'anthropic',input_tokens:1000,uncached_input_tokens:100,output_tokens:80,cache_creation_input_tokens:500,cache_read_input_tokens:400,cache_creation:{ephemeral_5m_input_tokens:200,ephemeral_1h_input_tokens:300},server_tool_use:{web_search_requests:2}});
 // Sonnet 5.5: 200 + 500 + 1200 + 40 + 800 microdollars, plus 2 searches.
 assert.ok(Math.abs(estimateUsageCost('claude-sonnet-5-5',m).cost-0.02274)<1e-10);
 assert.equal(estimateUsageCost('unknown',m).cost,null);
 assert.equal(estimateUsageCost('claude-sonnet-5-5',{...m,cache_creation_unclassified_input_tokens:5}).cost,null);
 const haiku=estimateUsageCost('claude-haiku-5-5',{...m,input_tokens:100001,web_search_requests:0});
 assert.equal(haiku.source,'anthropic_2026-11-12');
 assert.ok(haiku.cost>0);
});
test('la recherche reste active sauf conclusion documentée ou courte ouverture structurelle',()=>{
 const preceding=[{sources:Array.from({length:10},(_,i)=>({verified:true,url:'https://source.example/'+i}))}];
 assert.equal(needsWritingSearch({title:'Cadre théorique',preceding}),true);
 assert.equal(needsWritingSearch({title:'Conclusion générale',preceding}),false);
 assert.equal(needsWritingSearch({title:'Conclusion générale',preceding:[]}),true);
 assert.equal(needsWritingSearch({title:'Conclusion générale',preceding,instructions:'Rechercher des données récentes'}),true);
 assert.equal(needsWritingSearch({kind:'chapter_intro',targetWords:150,preceding}),false);
 assert.equal(needsWritingSearch({kind:'chapter_intro',targetWords:900,preceding}),true);
 assert.equal(needsWritingSearch({kind:'chapter',targetWords:150,preceding}),true);
});

test('les projets courts évitent le surcoût du cache d’une heure',()=>{
 assert.equal(writingCacheTtl(2),'5m');
 assert.equal(writingCacheTtl(30),'1h');
 const text='Documents\n\nPLAN : Plan\n\nBLOC À RÉDIGER : Introduction';
 const parts=cachedWritingPrompt(text,'Documents\n\n',writingCacheTtl(2));
 assert.equal(parts[0].cache_control.ttl,'5m');
 assert.equal(parts.map(p=>p.text).join(''),text);
});
