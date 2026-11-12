import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/academic.js';
import {signPricingQuote,calculateQuote} from '../lib/pricing.js';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.code=v;return this},json(v){this.body=v;return this},end(){return this}}}
test('site public : création et confirmation sandbox avec le compte habituel',async()=>{
 const saved={...process.env},oldFetch=globalThis.fetch;
 Object.assign(process.env,{VERCEL_ENV:'production',FEDAPAY_PUBLIC_SANDBOX_ENABLED:'true',FEDAPAY_SANDBOX_ENABLED:'true',SUPABASE_URL:'https://myzaepudoqnqnvpbopoy.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fake',FEDAPAY_SANDBOX_SUPABASE_REF:'abcdefghijklmnopqrst',FEDAPAY_SANDBOX_SECRET_KEY:'sk_sandbox_fake',FEDAPAY_SANDBOX_CALLBACK_URL:'https://trimemo-redac.company/?payment=fedapay',TRIMEMO_PRICING_SECRET:'fake-price',TRIMEMO_PREMIUM_AUTH_SECRET:'fake-premium',NODE_ENV:'test'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 let row=null,tx=null,grant=0;
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):{};
  if(u.includes('/auth/v1/user'))return Response.json({id:opts.headers.Authorization==='Bearer user1'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002',email:'client@example.test'});
  if(u.includes('/trimemo_client_projects'))return Response.json([{project_id:'p1'}]);
  if(u.endsWith('/trimemo_payment_intents')&&method==='POST'){if(row)return Response.json({}, {status:409});row={...body,state:'creating'};return Response.json([row]);}
  if(u.includes('/trimemo_payment_intents?')&&method==='PATCH'){Object.assign(row,body);return Response.json([row]);}
  if(u.includes('/trimemo_payment_intents?')&&method==='GET')return Response.json(row?[row]:[]);
  if(u.endsWith('/v1/transactions')){assert.equal(body.customer?.email,'client@example.test');tx={id:42,status:'pending',amount:body.amount,currency:{iso:'XOF'},custom_metadata:body.custom_metadata};return Response.json({'v1/transaction':tx});}
  if(u.endsWith('/42/token'))return Response.json({url:'https://fpay.li/sandbox'});
  if(u.includes('/v1/transactions/42?'))return Response.json({'v1/transaction':{...tx,status:'approved'}});
  if(u.endsWith('/rpc/confirm_trimemo_fedapay_sandbox')){grant++;return Response.json({status:'PAID',order_id:'fedapay-sandbox:42',project:row.project_snapshot});}
  throw Error('Unexpected URL: '+u);
 };
 try {
  const project={projectId:'p1',sujet:'Sujet',pages:10,typeDoc:'Mémoire',niveau:'Master',formula:'MASTER',files:[],paymentProblematicId:'q',paymentPlanId:'p',paidPreviewSnapshot:{problematic:{id:'q',question:'Question ?'},plan:{id:'p',parts:[{}]},introduction:{content:'Première phrase.'}}};
  project.pricingQuoteToken=signPricingQuote(calculateQuote({project,country:'BJ'}),project);
  const call=async(body,token='user1')=>{const r=response();await handler({method:'POST',query:{action:body.action==='create'?'create-mobile-money':'verify-mobile-money'},headers:{authorization:'Bearer '+token},socket:{remoteAddress:'127.0.0.4'},body},r);return r};
  const made=await call({action:'create',project});assert.equal(made.code,200);assert.equal(made.body.id,'42');assert.equal(row.state,'ready');
  const dup=await call({action:'create',project});assert.equal(dup.code,409);
  const wrong=await call({action:'verify',id:'42'},'user2');assert.equal(wrong.code,403);assert.equal(grant,0);
  const ok=await call({action:'verify',id:'42'});assert.equal(ok.code,200);assert.equal(ok.body.status,'PAID');assert.equal(ok.body.project.projectId,'p1');assert.ok(ok.body.premium_token);assert.equal(grant,1);
 } finally {globalThis.fetch=oldFetch;for(const k of Object.keys(process.env)) if(!(k in saved)) delete process.env[k];Object.assign(process.env,saved);}
});

import { createSandboxTransaction } from '../lib/fedapay-sandbox.js';
test('le site public refuse une clé live et un retour étranger',async()=>{
 const before={...process.env},oldFetch=globalThis.fetch;let calls=0;
 try {
  Object.assign(process.env,{VERCEL_ENV:'production',FEDAPAY_PUBLIC_SANDBOX_ENABLED:'true'});
  globalThis.fetch=async()=>{calls++;throw Error('Aucun appel attendu');};
  const tx={amount:100,reference:'trimemo_reference',callbackUrl:'https://trimemo-redac.company/?payment=fedapay'};
  await assert.rejects(createSandboxTransaction({...tx,key:'sk_live_fake'}),{status:503});
  await assert.rejects(createSandboxTransaction({...tx,key:'sk_sandbox_fake',callbackUrl:'https://attacker.example/?payment=fedapay'}),{status:400});
  assert.equal(calls,0);
 } finally {globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
