import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/client-account.js';

const response=()=>({setHeader(){},status(s){this.code=s;return this;},json(b){this.body=b;return this;},end(){return this;}});
test('une inscription répétée ne prétend pas qu’un nouveau courrier est envoyé',async()=>{
 const oldFetch=globalThis.fetch;
 const oldEnv={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
 process.env.SUPABASE_URL='https://database.invalid';
 process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
 globalThis.fetch=async()=>new Response(JSON.stringify({user:{id:'obfuscated',identities:[]}}),{status:200});
 try{
  const res=response();
  await handler({method:'POST',headers:{},body:{action:'signup',email:'a@demo.invalid',password:'passphrase1234',firstName:'A',lastName:'Demo'}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.confirmation_required,true);
  assert.match(res.body.message,/déjà un compte Trimémo/);
  assert.match(res.body.message,/un nouveau lien n’est pas envoyé/);
  assert.doesNotMatch(res.body.message,/lien a été envoyé/);
 }finally{globalThis.fetch=oldFetch;if(oldEnv.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldEnv.url;if(oldEnv.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldEnv.key;}
});
