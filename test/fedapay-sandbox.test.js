import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createSandboxTransaction,sandboxPaymentLink,sandboxTransaction,validateSandboxPayment,verifySandboxWebhook} from '../lib/fedapay-sandbox.js';

test('le parcours simulé utilise exclusivement le serveur de test FedaPay',async()=>{
 const old=globalThis.fetch;const seen=[];
 globalThis.fetch=async(input,options={})=>{
  const url=String(input);seen.push(url);assert.ok(url.startsWith('https://sandbox-api.fedapay.com/v1/'));
  if(url.endsWith('/transactions')) {const body=JSON.parse(options.body);assert.equal(body.amount,5000);assert.equal(body.currency.iso,'XOF');return Response.json({'v1/transaction':{id:42,amount:5000,status:'pending'}});}
  if(url.endsWith('/42/token'))return Response.json({url:'https://fpay.li/test-token'});
  if(url.includes('/42?'))return Response.json({'v1/transaction':{id:42,amount:5000,status:'approved',currency:{iso:'XOF'},custom_metadata:{trimemo_reference:'reference_test_123'}}});
  throw Error('Appel inattendu');
 };
 try {
  const tx=await createSandboxTransaction({key:'synthetic',amount:5000,reference:'reference_test_123',callbackUrl:'https://trimemo-redac.company/?payment=mobile-money'});
  assert.equal(tx.id,'42');assert.equal(await sandboxPaymentLink({key:'synthetic',transactionId:tx.id}),'https://fpay.li/test-token');
  const verified=await sandboxTransaction({key:'synthetic',transactionId:tx.id});
  assert.equal(validateSandboxPayment(verified,{id:'42',amount:5000,reference:'reference_test_123',currency:'XOF'}),true);
  for(const patch of [{amount:1},{id:43},{currency:{iso:'EUR'}},{custom_metadata:{trimemo_reference:'other'}},{refunded_at:'2026-01-01'}])assert.throws(()=>validateSandboxPayment({...verified,...patch},{id:'42',amount:5000,reference:'reference_test_123',currency:'XOF'}));
  assert.equal(validateSandboxPayment({...verified,status:'pending'},{id:'42',amount:5000,reference:'reference_test_123',currency:'XOF'}),false);
  assert.equal(seen.length,3);
 } finally {globalThis.fetch=old;}
});

test('un retour ou lien de paiement étranger est refusé',async()=>{
 let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({url:'https://fedapay.com.evil.invalid/pay'});};
 try {
  await assert.rejects(createSandboxTransaction({key:'synthetic',amount:5000,reference:'reference_test_123',callbackUrl:'https://trimemo-redac.company.evil.invalid/'}));
  assert.equal(calls,0);
  await assert.rejects(sandboxPaymentLink({key:'synthetic',transactionId:'42'}));
 } finally {globalThis.fetch=old;}
});

test('la devise est vérifiée auprès de FedaPay lorsque seule sa référence est fournie',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async(input)=>String(input).includes('/currencies/7')
  ? Response.json({'v1/currency':{id:7,iso:'XOF'}})
  : Response.json({'v1/transaction':{id:42,amount:5000,status:'approved',currency_id:7,custom_metadata:{trimemo_reference:'reference_test_123'}}});
 try {
  const tx=await sandboxTransaction({key:'synthetic',transactionId:'42'});
  assert.equal(validateSandboxPayment(tx,{id:'42',amount:5000,reference:'reference_test_123',currency:'XOF'}),true);
 } finally {globalThis.fetch=old;}
});

test('signature de webhook : message brut, horodatage et secret doivent correspondre',()=>{
 const raw=Buffer.from('{"name":"transaction.approved"}');const secret='synthetic-secret';const now=1760000000;
 const signature=crypto.createHmac('sha256',secret).update(now+'.').update(raw).digest('hex');const header=`t=${now},s=${signature}`;
 assert.equal(verifySandboxWebhook(raw,header,secret,now),true);
 assert.equal(verifySandboxWebhook(Buffer.from('{"name":"transaction.canceled"}'),header,secret,now),false);
 assert.equal(verifySandboxWebhook(raw,header,'wrong',now),false);
 assert.equal(verifySandboxWebhook(raw,header,secret,now+301),false);
 assert.equal(verifySandboxWebhook(raw,header,secret,now-301),false);
 assert.equal(verifySandboxWebhook(raw,`t=${now},t=${now},s=${signature}`,secret,now),false);
});
