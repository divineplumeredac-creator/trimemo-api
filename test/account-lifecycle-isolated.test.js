import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/client-account.js';
process.env.NODE_ENV='test';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.TRIMEMO_PREMIUM_AUTH_SECRET='synthetic-secret';
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
const result=()=>({setHeader(){},status(s){this.code=s;return this},json(body){this.body=body;return this},end(){return this}});
const projectId='11111111-1111-4111-8111-111111111111';
test('création puis reprise : seul le propriétaire peut ouvrir le projet',async()=>{
 const old=globalThis.fetch;let state=null;let membership=null;let paid=false;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(String(input));const method=options.method||'GET';
  if(url.pathname==='/auth/v1/user')return json({id:options.headers.Authorization==='Bearer token-a'?'user-a':'user-b'});
  if(url.pathname.endsWith('/trimemo_orders'))return json(paid?[{order_id:'synthetic-order',project_id:projectId,project_snapshot:{projectId,sujet:'Sujet fictif',formula:'LICENCE',typeDoc:'Mémoire'},status:'paid'}]:[]);
  if(url.pathname.endsWith('/trimemo_project_state')){
   if(method==='POST'){if(!state)state=JSON.parse(options.body);return json([state])}
   return json(state?[state]:[]);
  }
  if(url.pathname.endsWith('/trimemo_client_projects')){
   if(method==='POST'){if(!membership)membership=JSON.parse(options.body);return json([membership])}
   if(method==='PATCH'){if(membership?.user_id==='user-a')return json([membership]);return json([])}
   const filter=url.searchParams.get('user_id');return json(membership&&(!filter||filter==='eq.'+membership.user_id)?[membership]:[]);
  }
  throw new Error('Unexpected synthetic request '+url.pathname);
 };
 const call=async body=>{const res=result();await handler({method:'POST',headers:{},body},res);return res};
 try {
  const stateInput={schemaVersion:2,project:{projectId,sujet:'Sujet fictif'},blocks:[{id:'intro',kind:'introduction',content:'Texte conservé.',status:'done'}]};
  const created=await call({action:'link',token:'token-a',projectId,subject:'Sujet fictif',state:stateInput});assert.equal(created.code,200,JSON.stringify(created.body));
  const denied=await call({action:'link',token:'token-b',projectId,subject:'autre',state:stateInput});assert.equal(denied.code,409);
  const inaccessible=await call({action:'resume',token:'token-b',projectId});assert.equal(inaccessible.code,404);
  paid=true;
  const restored=await call({action:'resume',token:'token-a',projectId});assert.equal(restored.code,200,JSON.stringify(restored.body));assert.equal(restored.body.state.blocks[0].content,'Texte conservé.');assert.equal(membership.user_id,'user-a');
  assert.equal(restored.body.project.payment_status,'paid');assert.ok(restored.body.premium_token);
  const deniedPaid=await call({action:'resume',token:'token-b',projectId});assert.equal(deniedPaid.code,404);assert.equal(deniedPaid.body.premium_token,undefined);
 } finally {globalThis.fetch=old}
});
