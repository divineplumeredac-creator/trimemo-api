import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/client-account.js';
import stateHandler from '../api/project-state.js';
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

test('une propriété contradictoire bloque lecture, reprise et sauvegarde sans modifier le document',async()=>{
 const old=globalThis.fetch;let writes=0;
 const saved={project_id:projectId,owner_id:'user-b',state:{project:{projectId,sujet:'Document privé'},blocks:[]}};
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(String(input));const method=options.method||'GET';
  if(url.pathname==='/auth/v1/user')return json({id:'user-a'});
  if(url.pathname.endsWith('/trimemo_client_projects'))return json([{project_id:projectId,user_id:'user-a'}]);
  if(url.pathname.endsWith('/trimemo_project_state')){if(method==='POST')writes++;return json([saved]);}
  throw new Error('Unexpected synthetic request '+url.pathname);
 };
 try {
  const resume=result();await handler({method:'POST',headers:{},body:{action:'resume',token:'a',projectId}},resume);assert.equal(resume.code,409);assert.equal(resume.body.state,undefined);
  for(const method of ['GET','POST']){
   const res=result();await stateHandler({method,headers:{authorization:'Bearer a'},query:{projectId},body:{projectId,state:{project:{projectId},blocks:[]}}},res);
   assert.equal(res.code,409);assert.equal(res.body.state,undefined);
  }
  assert.equal(writes,0);assert.equal(saved.state.project.sujet,'Document privé');
 } finally {globalThis.fetch=old}
});

test('une sauvegarde ne peut pas mélanger deux projets',async()=>{
 const old=globalThis.fetch;let writes=0;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.pathname==='/auth/v1/user')return json({id:'user-a'});
  if(url.pathname.endsWith('/trimemo_client_projects'))return json([{project_id:projectId}]);
  if(url.pathname.endsWith('/trimemo_project_state')){if(options.method==='POST')writes++;return json([{owner_id:'user-a'}]);}
  throw new Error('Unexpected synthetic request '+url.pathname);
 };
 try { const res=result();await stateHandler({method:'POST',headers:{authorization:'Bearer a'},body:{projectId,state:{project:{projectId:'22222222-2222-4222-8222-222222222222'}}}},res);assert.equal(res.code,400);assert.equal(writes,0); }
 finally {globalThis.fetch=old}
});

test('la sauvegarde complète est reprise seulement dans le compte propriétaire',async()=>{
 const old=globalThis.fetch;
 let saved={project_id:projectId,owner_id:'user-a',state:{schemaVersion:2,project:{projectId,sujet:'Sujet'},blocks:[]}};
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(String(input)); const token=options.headers?.Authorization;
  if(url.pathname==='/auth/v1/user')return json({id:token==='Bearer token-a'?'user-a':'user-b'});
  if(url.pathname.endsWith('/trimemo_client_projects'))return json(url.searchParams.get('user_id')==='eq.user-a'?[{project_id:projectId}]:[]);
  if(url.pathname.endsWith('/trimemo_project_state')){
   if(options.method==='POST') saved={...saved,...JSON.parse(options.body)};
   return json([saved]);
  }
  throw new Error('Unexpected synthetic request '+url.pathname);
 };
 try {
  const next={schemaVersion:2,project:{projectId,sujet:'Sujet enregistré',files:[{name:'guide.pdf',content:''}]},selectedPlan:{id:'plan-1'},blocks:[{id:'intro',content:'Un texte complet.',status:'done'}]};
  const write=result();await stateHandler({method:'POST',headers:{authorization:'Bearer token-a'},body:{projectId,state:next}},write);assert.equal(write.code,200);
  const read=result();await stateHandler({method:'GET',headers:{authorization:'Bearer token-a'},query:{projectId}},read);assert.equal(read.code,200);assert.deepEqual(read.body.state,next);
  const denied=result();await stateHandler({method:'GET',headers:{authorization:'Bearer token-b'},query:{projectId}},denied);assert.equal(denied.code,403);assert.equal(denied.body.state,undefined);
  const deniedWrite=result();await stateHandler({method:'POST',headers:{authorization:'Bearer token-b'},body:{projectId,state:{project:{projectId},blocks:[]}}},deniedWrite);assert.equal(deniedWrite.code,403);assert.deepEqual(saved.state,next);
 } finally {globalThis.fetch=old}
});
