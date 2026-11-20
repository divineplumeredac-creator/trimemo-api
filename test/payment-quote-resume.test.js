import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote, defaultPricingConfig, signPricingQuote, verifyPricingQuote} from '../lib/pricing.js';
import {renewPaymentQuote} from '../lib/payment-quote.js';
import handler from '../api/academic.js';

process.env.TRIMEMO_PRICING_SECRET='resume-test-secret';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.TRIMEMO_PREMIUM_AUTH_SECRET='synthetic-premium';
process.env.PAYPAL_CLIENT_ID='synthetic';
process.env.PAYPAL_CLIENT_SECRET='synthetic';
process.env.NODE_ENV='test';
const p=()=>({projectId:'resume-project',sujet:'Sujet',pages:15,typeDoc:'Mémoire',niveau:'Master',formula:'MASTER',files:[],paymentProblematicId:'q',paymentPlanId:'p',paidPreviewSnapshot:{problematic:{id:'q',question:'Question ?'},plan:{id:'p',parts:[{}]},introduction:{content:'Texte terminé.'}}});
function oldQuote(project){const now=Date.now; try {Date.now=()=>now()-3*86400000;return signPricingQuote(calculateQuote({project,country:'BJ'}),project)} finally{Date.now=now}}
const settings=()=>({pricing_config:defaultPricingConfig()});

test('une estimation expirée et inchangée est renouvelée sans changer le prix',async()=>{
 const project=p();project.pricingQuoteToken=oldQuote(project);assert.equal(verifyPricingQuote(project.pricingQuoteToken,project),null);
 const result=await renewPaymentQuote(project,settings);assert.ok(verifyPricingQuote(result.project.pricingQuoteToken,project));assert.equal(result.quote.estimatedAmount,calculateQuote({project,country:'BJ'}).estimatedAmount);
});
test('refuse une signature altérée, un projet ou une pièce jointe modifiés et un tarif changé',async()=>{
 const project=p();project.files=[{name:'guide.pdf',type:'application/pdf',category:'guide',content:'document original'}];project.pricingQuoteToken=oldQuote(project);
 for(const changed of [{...project,pages:16},{...project,files:[{...project.files[0],content:'autre document'}]},{...project,pricingQuoteToken:project.pricingQuoteToken+'x'}]) await assert.rejects(()=>renewPaymentQuote(changed,settings),{status:409});
 const modified=settings();modified.pricing_config.markets.africa.rates.memoire*=2;
 await assert.rejects(()=>renewPaymentQuote(project,()=>modified),{status:409});
});
test('le retour après 24 h ouvre PayPal avec le prix confirmé sans nouvel appel d’analyse',async()=>{
 const project=p();project.pricingQuoteToken=oldQuote(project);const oldFetch=globalThis.fetch;let record=null,charged=null;
 globalThis.fetch=async(input,options={})=>{const u=String(input),method=options.method||'GET';
  if(u.includes('trimemo_orders?select='))return Response.json([]);
  if(u.includes('trimemo_orders?order_id='))return Response.json(record?[record]:[]);
  if(u.includes('trimemo_orders?on_conflict=')&&method==='POST'){record=JSON.parse(options.body);return Response.json([record]);}
  if(u.includes('/auth/v1/user'))return Response.json({id:'owner'});
  if(u.includes('/trimemo_client_projects?'))return Response.json([{project_id:project.projectId}]);
  if(u.includes('/trimemo_admin_settings?'))return Response.json([{id:'main',...settings()}]);
  if(u.includes('/v1/oauth2/token'))return Response.json({access_token:'synthetic'});
  if(u.endsWith('/v2/checkout/orders')){charged=JSON.parse(options.body).purchase_units[0].amount;return Response.json({id:'order-test',links:[{rel:'payer-action',href:'https://example.test/pay'}]});}
  throw Error('unexpected '+u);
 };
 try {const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};await handler({method:'POST',headers:{authorization:'Bearer client'},query:{action:'create-paypal-order'},body:{project}},res);assert.equal(res.code,200);assert.equal(charged.value,calculateQuote({project,country:'BJ'}).checkoutAmount);assert.equal(record.status,'pending');assert.ok(verifyPricingQuote(record.project_snapshot.pricingQuoteToken,project));} finally {globalThis.fetch=oldFetch}
});

test('FedaPay en configuration réelle crée une tentative simulée après expiration',async()=>{
 const saved={...process.env},oldFetch=globalThis.fetch;let row=null,amount=null;
 Object.assign(process.env,{VERCEL_ENV:'production',FEDAPAY_ENV:'live',FEDAPAY_LIVE_SECRET_KEY:'sk_live_fake',FEDAPAY_LIVE_CALLBACK_URL:'https://trimemo-redac.company/?payment=fedapay',SUPABASE_URL:'https://myzaepudoqnqnvpbopoy.supabase.co'});
 delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;
 const project=p();project.pricingQuoteToken=oldQuote(project);
 globalThis.fetch=async(input,opts={})=>{const u=String(input),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):{};
  if(u.includes('/auth/v1/user'))return Response.json({id:'owner',email:'fictif@example.invalid'});
  if(u.includes('/trimemo_client_projects?'))return Response.json([{project_id:project.projectId}]);
  if(u.includes('/trimemo_admin_settings?'))return Response.json([{id:'main',...settings()}]);
  if(u.endsWith('/trimemo_live_payment_intents')&&method==='POST'){row={...body,state:'creating'};return Response.json([row]);}
  if(u.includes('/trimemo_live_payment_intents?')&&method==='PATCH'){Object.assign(row,body);return Response.json([row]);}
  if(u==='https://api.fedapay.com/v1/transactions'){amount=body.amount;return Response.json({'v1/transaction':{id:42,status:'pending',amount}});}
  if(u==='https://api.fedapay.com/v1/transactions/42/token')return Response.json({url:'https://fpay.li/simulated'});
  throw Error('Requête de test non prévue');
 };
 try {const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};await handler({method:'POST',headers:{authorization:'Bearer client'},query:{action:'create-mobile-money'},body:{project}},res);assert.equal(res.code,200);assert.equal(amount,calculateQuote({project,country:'BJ'}).estimatedAmount);assert.equal(row.state,'ready');assert.ok(verifyPricingQuote(row.project_snapshot.pricingQuoteToken,project));} finally {globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
});
