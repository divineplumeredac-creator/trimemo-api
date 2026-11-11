import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFingerprint, paymentBinding } from '../lib/premium-auth.js';
import handler from '../api/academic.js';

process.env.NODE_ENV='test';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.PAYPAL_CLIENT_ID='synthetic';
process.env.PAYPAL_CLIENT_SECRET='synthetic';
process.env.TRIMEMO_PREMIUM_AUTH_SECRET='synthetic-secret';
const project={projectId:'synthetic-project',sujet:'Sujet fictif',formula:'LICENCE',typeDoc:'Mémoire'};
const record={order_id:'synthetic-order',project_id:project.projectId,project_fingerprint:projectFingerprint(project),project_snapshot:project,status:'paid',amount:'10.00',currency:'EUR'};
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
const result=()=>({setHeader(){},status(s){this.code=s;return this},json(data){this.body=data;return this},end(){return this}});
test('vérification autorisée seulement au propriétaire, avant tout appel fournisseur',async()=>{
 const real=globalThis.fetch;let calls=[];let approved=false;
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);calls.push(url);
  if(url.includes('trimemo_orders?select='))return json([]);
  if(url.includes('trimemo_orders?order_id='))return json([record]);
  if(url.includes('trimemo_orders?') && options.method==='PATCH')return json([{...record,status:'paid'}]);
  if(url.includes('/auth/v1/user'))return json({id:options.headers.Authorization==='Bearer owner-token'?'owner':'other'});
  if(url.includes('trimemo_client_projects?'))return json(url.includes('user_id=eq.owner')?[{project_id:project.projectId}]:[]);
  if(url.includes('/v1/oauth2/token'))return json({access_token:'synthetic'});
  if(url.includes('/v2/checkout/orders/'))return json({id:'synthetic-order',status:approved && !url.endsWith('/capture')?'APPROVED':'COMPLETED',purchase_units:[{custom_id:'LICENCE|'+paymentBinding(project),payments:{captures:[{id:'synthetic-capture',amount:{value:'10.00',currency_code:'EUR'}}]}}]});
  throw new Error('unexpected synthetic request');
 };
 try {
  for(const [token,status] of [['',401],['other-token',403]]){
   calls=[];const res=result();await handler({method:'POST',headers:token?{authorization:'Bearer '+token}:{},query:{action:'verify-paypal'},body:{id:'synthetic-order'}},res);
   assert.equal(res.code,status);assert.equal(Boolean(res.body?.premium_token),false);assert.equal(Boolean(res.body?.project),false);assert.equal(calls.some(u=>u.includes('paypal.com')),false);
  }
  calls=[];const res=result();await handler({method:'POST',headers:{authorization:'Bearer owner-token'},query:{action:'verify-paypal'},body:{id:'synthetic-order'}},res);
  assert.equal(res.code,200);assert.equal(res.body.status,'PAID');assert.ok(res.body.premium_token);assert.equal(calls.filter(u=>u.includes('/v2/checkout/orders/')).length,1);
  approved=true; record.status='pending';
  calls=[];const wrong=result();await handler({method:'POST',headers:{authorization:'Bearer other-token'},query:{action:'verify-paypal'},body:{id:'synthetic-order'}},wrong);
  assert.equal(wrong.code,403);assert.equal(calls.some(u=>u.includes('paypal.com')),false);
  calls=[];const allowed=result();await handler({method:'POST',headers:{authorization:'Bearer owner-token'},query:{action:'verify-paypal'},body:{id:'synthetic-order'}},allowed);
  assert.equal(allowed.code,200);assert.equal(calls.filter(u=>u.endsWith('/capture')).length,1);
 } finally {globalThis.fetch=real;}
});
