import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedOrigin, getFrontendOrigin } from '../lib/http.js';
import account from '../api/client-account.js';
import academic from '../api/academic.js';
import { calculateQuote, signPricingQuote } from '../lib/pricing.js';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.TRIMEMO_FRONTEND_URL='https://trimemo-frontend.vercel.app';
process.env.TRIMEMO_PRICING_SECRET='synthetic-pricing';
process.env.TRIMEMO_PREMIUM_AUTH_SECRET='synthetic-premium';
process.env.PAYPAL_CLIENT_ID='synthetic';
process.env.PAYPAL_CLIENT_SECRET='synthetic';
process.env.PAYPAL_ENV='sandbox';
const old='https://trimemo-frontend.vercel.app';
const current='https://trimemo-redac.company';
const req = origin => ({headers:{origin}});
const res = () => ({headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.code=s;return this},json(body){this.body=body;return this},end(){return this}});

test('CORS autorise les deux domaines et refuse les domaines trompeurs',()=>{
 for(const origin of [old,current]) {assert.equal(getAllowedOrigin(req(origin)),origin);assert.equal(getFrontendOrigin(req(origin)),origin);}
 for(const origin of ['https://trimemo-redac.company.attacker.invalid','https://evil.invalid','http://trimemo-redac.company']) {
  assert.notEqual(getAllowedOrigin(req(origin)),origin);
  assert.equal(getFrontendOrigin(req(origin)),old);
 }
});

test('confirmation, renvoi et réinitialisation reviennent sur le domaine utilisé',async()=>{
 const original=globalThis.fetch;let destination;
 globalThis.fetch=async input=>{destination=new URL(String(input)).searchParams.get('redirect_to');return Response.json({id:'synthetic'});};
 try {
  for(const origin of [old,current]) for(const [action,params,expected] of [
   ['signup',{email:'test@example.invalid',password:'abcdefgh',firstName:'Test',lastName:'Client',startProject:true},'/?account=confirmed&start=1'],
   ['resend-confirmation',{email:'test@example.invalid',startProject:true},'/?account=confirmed&start=1'],
   ['forgot-password',{email:'test@example.invalid'},'/?reset-password=1'],
  ]) {
   const response=res();await account({method:'POST',headers:{origin},body:{action,...params}},response);
   assert.equal(response.code,200,action);assert.equal(destination,origin+expected);
  }
 } finally {globalThis.fetch=original;}
});

test('création PayPal simulée : les retours restent sur le domaine de la session',async()=>{
 const original=globalThis.fetch;let orderPayload,record,sequence=0;
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);
  if(url.includes('trimemo_orders?select='))return Response.json([]);
  if(url.includes('trimemo_orders?order_id='))return Response.json(record?[record]:[]);
  if(url.includes('trimemo_orders?on_conflict=') && options.method==='POST'){record=JSON.parse(options.body);return Response.json([record]);}
  if(url.includes('/auth/v1/user'))return Response.json({id:'owner'});
  if(url.includes('trimemo_client_projects?'))return Response.json([{project_id:'project-test'}]);
  if(url.includes('/v1/oauth2/token'))return Response.json({access_token:'synthetic'});
  if(url.endsWith('/v2/checkout/orders')){orderPayload=JSON.parse(options.body);return Response.json({id:'fake-order-'+(++sequence),links:[{rel:'approve',href:'https://sandbox.invalid/approve'}]});}
  throw Error('Réseau inattendu pendant le test isolé');
 };
 try {
  for(const origin of [old,current,'https://evil.invalid']) {
   record=null;
   const project={projectId:'project-test',sujet:'Sujet fictif',formula:'LICENCE',typeDoc:'Mémoire',niveau:'Licence',pages:15,files:[],paymentProblematicId:'question',paymentPlanId:'plan',paidPreviewSnapshot:{problematic:{id:'question',question:'Question ?'},plan:{id:'plan',parts:[{}]},introduction:{content:'Introduction complète.'},chapterOne:{content:''}}};
   project.pricingQuoteToken=signPricingQuote(calculateQuote({project}),project);
   const response=res();await academic({method:'POST',headers:{origin,authorization:'Bearer synthetic'},query:{action:'create-paypal-order'},body:{project}},response);
   assert.equal(response.code,200,JSON.stringify(response.body));
   const expected=origin==='https://evil.invalid'?old:origin;
   assert.equal(orderPayload.payment_source.paypal.experience_context.return_url,expected+'/?payment=paypal');
   assert.equal(orderPayload.payment_source.paypal.experience_context.cancel_url,expected+'/?payment=paypal_cancelled');
  }
 } finally {globalThis.fetch=original;}
});
