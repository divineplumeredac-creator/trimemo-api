import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProjectState } from '../api/client-account.js';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
const response = data => new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
test('une écriture concurrente ne remplace jamais le propriétaire existant',async()=>{
 const original=globalThis.fetch;let reads=0;let preference='';
 globalThis.fetch=async (_url,init={})=>{
  if(init.method==='POST'){preference=init.headers.Prefer;return response([])}
  reads++;return response(reads===1?[]:[{owner_id:'compte-b',state:{project:{projectId:'p'}}}]);
 };
 try {await assert.rejects(ensureProjectState('p','compte-a',{project:{projectId:'p'}}),e=>e.status===409);assert.match(preference,/ignore-duplicates/);assert.equal(reads,2)} finally {globalThis.fetch=original}
});
test('un brouillon sans propriétaire ne peut pas être revendiqué silencieusement',async()=>{
 const original=globalThis.fetch;let writes=0;
 globalThis.fetch=async (_url,init={})=>{if(init.method==='POST')writes++;return response([{owner_id:null,state:{project:{projectId:'p'}}}])};
 try {await assert.rejects(ensureProjectState('p','compte-a',{project:{projectId:'p'}}),e=>e.status===409);assert.equal(writes,0)} finally {globalThis.fetch=original}
});
test('un projet déjà détenu reste inchangé pendant le rattachement',async()=>{
 const original=globalThis.fetch;let writes=0;
 globalThis.fetch=async (_url,init={})=>{if(init.method==='POST')writes++;return response([{owner_id:'compte-a',state:{project:{projectId:'p'}}}])};
 try {await ensureProjectState('p','compte-a',{project:{projectId:'p'},content:'modifié'});assert.equal(writes,0)} finally {globalThis.fetch=original}
});
test('un nouveau projet garde son propriétaire après insertion',async()=>{
 const original=globalThis.fetch;let reads=0;let writes=0;
 globalThis.fetch=async (_url,init={})=>{if(init.method==='POST'){writes++;return response([])}reads++;return response(reads===1?[]:[{owner_id:'compte-a',state:{project:{projectId:'p'}}}])};
 try {await ensureProjectState('p','compte-a',{project:{projectId:'p'}});assert.equal(writes,1);assert.equal(reads,2)} finally {globalThis.fetch=original}
});
