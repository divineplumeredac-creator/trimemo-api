import test from 'node:test';
import assert from 'node:assert/strict';
import {refundOrder} from '../api/admin-console.js';
import {assertOrderUsable} from '../lib/order-ledger.js';
process.env.SUPABASE_URL='https://db.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='secret';process.env.PAYPAL_CLIENT_ID='id';process.env.PAYPAL_CLIENT_SECRET='secret';process.env.PAYPAL_ENV='sandbox';
const json=(x,status=200)=>Response.json(x,{status});
function setup(){
 const order={order_id:'PAYPAL-ORDER-TEST',project_id:'p1',status:'paid',amount:'10.00',currency:'EUR',capture_id:'CAPTURE-TEST',refund_status:'none',refund_amount:null,refund_id:null,project_fingerprint:'irrelevant'};
 const calls=[];let uncertain=false;
 const fetch=async(url,init={})=>{url=String(url);calls.push({url,init});
  if(url.includes('/v1/oauth2/token'))return json({access_token:'test'});
  if(url.includes('/v2/payments/captures/')){if(uncertain)throw Error('timeout');let data=JSON.parse(init.body);return json({id:'refund-test',status:'COMPLETED',amount:{value:data.amount?.value||'10.00',currency_code:'EUR'}},201)}
  if(url.includes('/trimemo_orders?')){if(init.method==='PATCH'){if(url.includes('refund_status=in.')&&order.refund_status!=='none'&&order.refund_status!=='failed')return json([]);Object.assign(order,JSON.parse(init.body));return json([order])}return json([order])}
  if(url.includes('/trimemo_admin_logs'))return json([]);throw Error('unexpected '+url);
 };
 return {order,calls,fetch,makeUncertain(){uncertain=true}};
}
test('remboursement partiel : montant exact, accès premium bloqué et doublon refusé',async()=>{
 const real=global.fetch,t=setup();global.fetch=t.fetch;try{
  const result=await refundOrder(t.order.order_id,'owner','partial','3,25');assert.equal(result.refund_amount,'3.25');assert.equal(result.refund_status,'refunded');assert.equal(result.status,'refunded');
  const request=t.calls.find(x=>x.url.includes('/v2/payments/captures/'));assert.deepEqual(JSON.parse(request.init.body),{amount:{value:'3.25',currency_code:'EUR'}});assert.match(request.init.headers['PayPal-Request-Id'],/^trimemo-refund-/);
  await assert.rejects(()=>assertOrderUsable({payment:t.order.order_id},{projectId:'p1'}),e=>e.status===403);
  await assert.rejects(()=>refundOrder(t.order.order_id,'owner','full'),e=>e.status===409);
 }finally{global.fetch=real}
});
test('remboursement total et montants invalides',async()=>{
 const real=global.fetch,t=setup();global.fetch=t.fetch;try{
  await assert.rejects(()=>refundOrder(t.order.order_id,'owner','partial','11'),e=>e.status===400);assert.equal(t.calls.some(x=>x.url.includes('paypal.com')),false);
  const result=await refundOrder(t.order.order_id,'owner','full');assert.equal(result.refund_amount,'10.00');assert.deepEqual(JSON.parse(t.calls.find(x=>x.url.includes('/v2/payments/captures/')).init.body),{});
 }finally{global.fetch=real}
});
test('échec de connexion PayPal : opération en attente sans renvoi automatique',async()=>{
 const real=global.fetch,t=setup();t.makeUncertain();global.fetch=t.fetch;try{
  await assert.rejects(()=>refundOrder(t.order.order_id,'owner','partial','2.00'),e=>e.status===502);assert.equal(t.order.refund_status,'processing');
  await refundOrder(t.order.order_id,'owner','partial','2.00');assert.equal(t.calls.filter(x=>x.url.includes('/v2/payments/captures/')).length,1);
 }finally{global.fetch=real}
});
test('un paiement FedaPay ne peut pas passer par PayPal',async()=>{
 const real=global.fetch,t=setup();t.order.order_id='fedapay-live:123';global.fetch=t.fetch;try{await assert.rejects(()=>refundOrder(t.order.order_id,'owner','full'),e=>e.status===409);assert.equal(t.calls.some(x=>x.url.includes('paypal.com')),false)}finally{global.fetch=real}
});
test('le refus PayPal est diagnostiqué sans enregistrer sa réponse brute',async()=>{
 const real=global.fetch,t=setup();let logs=[];
 global.fetch=async(url,init={})=>{
  if(String(url).includes('/v2/payments/captures/'))return json({name:'UNPROCESSABLE_ENTITY',details:[{issue:'INSUFFICIENT_FUNDS',description:'sensitive'}],debug_id:'abc123'},422);
  if(String(url).includes('/trimemo_admin_logs')){logs.push(JSON.parse(init.body));return json([])}
  return t.fetch(url,init);
 };
 try{await assert.rejects(()=>refundOrder(t.order.order_id,'owner','full'),e=>e.status===502);assert.equal(t.order.refund_status,'failed');assert.equal(logs[0].metadata.providerIssue,'INSUFFICIENT_FUNDS');assert.equal(logs[0].metadata.providerDebugId,'abc123');assert.doesNotMatch(JSON.stringify(logs),/sensitive/)}finally{global.fetch=real}
});
