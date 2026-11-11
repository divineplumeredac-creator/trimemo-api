import test from 'node:test';
import assert from 'node:assert/strict';
import estimate from '../api/estimate-project.js';
import problematics from '../api/generate-problematics.js';
import plans from '../api/generate-plans.js';
import block from '../api/generate-block.js';
import preview from '../api/generate-free-preview.js';
process.env.NODE_ENV='test';
process.env.TRIMEMO_CLAUDE_API_KEY='synthetic';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
const project={projectId:'synthetic-project',sujet:'Sujet fictif',pages:15,typeDoc:'Mémoire',niveau:'Licence',files:[]};
function result(){return{headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.code=s;return this},json(data){this.body=data;return this},end(){return this},send(data){this.body=data;return this}}}
test('les routes refusent une génération sans compte avant appel au fournisseur',async()=>{
 const old=globalThis.fetch;let providerCalls=0;
 globalThis.fetch=async input=>{if(String(input).includes('anthropic'))providerCalls++;throw new Error('unexpected network call')};
 try {
  for(const [name,handler,body] of [['estimate',estimate,{project}],['problematics',problematics,{project}],['plans',plans,{project}],['block',block,{project,previewMode:true}],['preview',preview,{project}]]){
   const res=result();await handler({method:'POST',headers:{},body,query:{}},res);
   assert.equal(res.code,401,name+': '+JSON.stringify(res.body));
  }
  assert.equal(providerCalls,0);
 } finally {globalThis.fetch=old}
});
test('un compte différent ne peut pas générer sur le projet d’autrui',async()=>{
 const old=globalThis.fetch;let providerCalls=0;
 globalThis.fetch=async input=>{const url=String(input);if(url.includes('anthropic')){providerCalls++;throw new Error('unexpected provider')}return new Response(JSON.stringify(url.includes('/auth/v1/user')?{id:'autre-compte'}:[]),{status:200,headers:{'content-type':'application/json'}})};
 try {
  for(const [name,handler,body] of [['estimate',estimate,{project}],['problematics',problematics,{project}],['plans',plans,{project}],['block',block,{project,previewMode:true}],['preview',preview,{project}]]){
   const res=result();await handler({method:'POST',headers:{'x-trimemo-client-token':'autre-jeton'},body,query:{}},res);
   assert.equal(res.code,403,name+': '+JSON.stringify(res.body));
  }
  assert.equal(providerCalls,0);
 } finally {globalThis.fetch=old}
});
