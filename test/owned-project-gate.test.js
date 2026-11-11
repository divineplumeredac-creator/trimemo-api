import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOwnedProject } from '../lib/owned-project-gate.js';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
const reply=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
test('exige le compte propriétaire et ne confond pas le jeton premium avec le compte',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);
  if(url.includes('/auth/v1/user'))return reply({id:options.headers.Authorization==='Bearer account-a'?'account-a':'account-b'});
  if(url.includes('/rest/v1/trimemo_client_projects?'))return reply(url.includes('user_id=eq.account-a')?[{project_id:'project-a'}]:[]);
  if(url.includes('/rest/v1/trimemo_project_state?'))return reply([{owner_id:'account-a'}]);
  throw new Error('unexpected request');
 };
 try {
  await assert.rejects(requireOwnedProject({headers:{}},{projectId:'project-a'}),e=>e.status===401);
  await assert.rejects(requireOwnedProject({headers:{'x-trimemo-client-token':'account-b'}},{projectId:'project-a'}),e=>e.status===403);
  assert.equal((await requireOwnedProject({headers:{'x-trimemo-client-token':'account-a','x-trimemo-premium-token':'premium'}},{projectId:'project-a'})).id,'account-a');
  await assert.rejects(requireOwnedProject({headers:{}},{}),e=>e.status===400);
 } finally {globalThis.fetch=old}
});

test('refuse la génération si le propriétaire du document contredit le compte',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async(input)=>{
  const url=String(input);
  if(url.includes('/auth/v1/user'))return reply({id:'account-a'});
  if(url.includes('/rest/v1/trimemo_client_projects?'))return reply([{project_id:'project-a'}]);
  if(url.includes('/rest/v1/trimemo_project_state?'))return reply([{owner_id:'account-b'}]);
  throw new Error('unexpected request');
 };
 try { await assert.rejects(requireOwnedProject({headers:{'x-trimemo-client-token':'account-a'}},{projectId:'project-a'}),e=>e.status===409); }
 finally {globalThis.fetch=old}
});
