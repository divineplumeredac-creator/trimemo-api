import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/client-account.js';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.TRIMEMO_FRONTEND_URL='https://frontend.invalid';
const result=()=>({setHeader(){},status(s){this.code=s;return this},json(body){this.body=body;return this},end(){return this}});
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
const signup={action:'signup',email:'test@example.invalid',password:'abcdefgh',firstName:'Test',lastName:'Client',startProject:true};
test('inscription : demande une confirmation et ne crée pas de session avant le lien',async()=>{
 const old=globalThis.fetch;let called;
 globalThis.fetch=async(input,init)=>{called={url:new URL(String(input)),body:JSON.parse(init.body)};return json({id:'new-user'});};
 try {const res=result();await handler({method:'POST',headers:{},body:signup},res);assert.equal(res.code,200);assert.equal(res.body.confirmation_required,true);assert.equal(res.body.token,undefined);assert.equal(called.url.pathname,'/auth/v1/signup');assert.equal(new URL(called.url.searchParams.get('redirect_to')).searchParams.get('start'),'1');assert.equal(called.body.email_confirm,undefined);}
 finally {globalThis.fetch=old}
});
test('une configuration qui confirme automatiquement ne donne pas de session à la création',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>json({access_token:'unsafe'});
 try {const res=result();await handler({method:'POST',headers:{},body:signup},res);assert.equal(res.code,503);assert.equal(res.body.token,undefined);}
 finally {globalThis.fetch=old}
});
test('le retour de confirmation exige une adresse réellement confirmée',async()=>{
 const old=globalThis.fetch;let confirmed=false;globalThis.fetch=async()=>json({id:'user-a',email_confirmed_at:confirmed?'2026-01-01T00:00:00Z':null});
 try {let res=result();await handler({method:'POST',headers:{},body:{action:'confirm-session',token:'synthetic'}},res);assert.equal(res.code,403);confirmed=true;res=result();await handler({method:'POST',headers:{},body:{action:'confirm-session',token:'synthetic'}},res);assert.equal(res.code,200);assert.equal(res.body.user.id,'user-a');}
 finally {globalThis.fetch=old}
});
test('le renvoi conserve la destination du projet sans créer de session',async()=>{
 const old=globalThis.fetch;let sent;
 globalThis.fetch=async(input,init)=>{sent={url:new URL(String(input)),body:JSON.parse(init.body)};return json({});};
 try {const res=result();await handler({method:'POST',headers:{},body:{action:'resend-confirmation',email:'test@example.invalid',startProject:true}},res);assert.equal(res.code,200);assert.equal(sent.url.pathname,'/auth/v1/resend');assert.equal(sent.body.type,'signup');assert.equal(new URL(sent.url.searchParams.get('redirect_to')).searchParams.get('start'),'1');assert.equal(res.body.token,undefined);}
 finally {globalThis.fetch=old}
});

test('candidature ambassadeur : origine canonique et intention conservée sur le compte',async()=>{
 const original=globalThis.fetch, previous=process.env.VERCEL_ENV;
 process.env.VERCEL_ENV='production';
 let request;
 globalThis.fetch=async(input,init)=>{request={url:new URL(String(input)),body:JSON.parse(init.body)};return json({id:'candidate'});};
 try {
   const res=result();
   await handler({method:'POST',headers:{origin:'https://trimemo-frontend.vercel.app'},body:{action:'signup',email:'candidate@example.invalid',password:'abcdefgh',firstName:'Test',lastName:'Ambassadeur',ambassador:true}},res);
   assert.equal(res.code,200);
   assert.equal(new URL(request.url.searchParams.get('redirect_to')).origin,'https://trimemo-redac.company');
   assert.equal(new URL(request.url.searchParams.get('redirect_to')).searchParams.get('next'),'ambassadors');
   assert.equal(request.body.data.onboarding_intent,'ambassador');
 } finally {
   globalThis.fetch=original;
   if(previous===undefined)delete process.env.VERCEL_ENV;
   else process.env.VERCEL_ENV=previous;
 }
});
test('confirmation ambassadeur : le serveur renvoie la destination même sans next dans l’URL',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>json({id:'candidate',email:'candidate@example.invalid',email_confirmed_at:'2026-11-15T00:00:00Z',user_metadata:{first_name:'Test',last_name:'Ambassadeur',onboarding_intent:'ambassador'}});
 try {
   const res=result();
   await handler({method:'POST',headers:{},body:{action:'confirm-session',token:'synthetic'}},res);
   assert.equal(res.code,200);
   assert.equal(res.body.user.signupIntent,'ambassador');
 } finally { globalThis.fetch=original; }
});
