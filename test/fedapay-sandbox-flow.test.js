import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxPaymentFlow } from '../lib/fedapay-sandbox-flow.js';

function setup() {
  const intents = new Map(); let creates=0; let confirms=0;
  const repository = {
    async reserve(intent) { if ([...intents.values()].some(i=>i.projectId===intent.projectId)) return null; intents.set(intent.reference,{ ...intent, state:'creating' }); return intents.get(intent.reference); },
    async attachProviderId({reference,providerId}) { Object.assign(intents.get(reference),{providerId}); },
    async markReady({reference}) { intents.get(reference).state='ready'; },
    async findByProviderId(id) { return [...intents.values()].find(i=>i.providerId===id); },
    async confirmApproved({reference}) { const i=intents.get(reference); if(i.state!=='paid'){i.state='paid'; confirms++;} return {status:'PAID',projectId:i.projectId}; },
  };
  const provider = {
    async createSandboxTransaction() { creates++; return {id:'123'}; },
    async sandboxPaymentLink() { return 'https://fpay.li/example'; },
    async sandboxTransaction() { return {id:'123',amount:2500,merchant_reference:'reference_123',currency:{iso:'XOF'},status:'approved'}; },
  };
  const flow=createSandboxPaymentFlow({ repository, provider, key:'test', callbackUrl:'https://example.invalid' });
  return {flow,provider,intents,counts:()=>({creates,confirms})};
}
const args={userId:'u1',projectId:'p1',reference:'reference_123',project:{projectId:'p1'},quote:{currency:'XOF',estimatedAmount:2500}};

test('une réservation durable précède la redirection et une seule confirmation est accordée',async()=>{
 const {flow,counts}=setup(); assert.deepEqual(await flow.begin(args),{id:'123',url:'https://fpay.li/example'});
 assert.deepEqual(await flow.verify({userId:'u1',providerId:'123'}),{status:'PAID',projectId:'p1'});
 await flow.verify({userId:'u1',providerId:'123'}); assert.deepEqual(counts(),{creates:1,confirms:1});
});
test('un autre compte et un montant modifié sont refusés',async()=>{
 const {flow,provider,counts}=setup(); await flow.begin(args);
 await assert.rejects(flow.verify({userId:'u2',providerId:'123'}),{status:403});
 provider.sandboxTransaction=async()=>({id:'123',amount:1,merchant_reference:'reference_123',currency:{iso:'XOF'},status:'approved'});
 await assert.rejects(flow.verify({userId:'u1',providerId:'123'}),{status:403}); assert.equal(counts().confirms,0);
});
test('un statut non approuvé ne débloque pas le projet',async()=>{
 const {flow,provider,counts}=setup(); await flow.begin(args);
 provider.sandboxTransaction=async()=>({id:'123',amount:2500,merchant_reference:'reference_123',currency:{iso:'XOF'},status:'pending'});
 assert.deepEqual(await flow.verify({userId:'u1',providerId:'123'}),{status:'PENDING'}); assert.equal(counts().confirms,0);
});
test('après une réponse perdue la réservation empêche une seconde création',async()=>{
 const {flow,provider,intents}=setup(); let calls=0;
 provider.createSandboxTransaction=async()=>{calls++;throw Error('timeout')};
 await assert.rejects(flow.begin(args)); await assert.rejects(flow.begin({...args,reference:'reference_456'}),{status:409});
 assert.equal(calls,1); assert.equal(intents.get(args.reference).state,'creating');
});
test('les réservations concurrentes et les devis non CFA sont refusés',async()=>{
 const {flow,counts}=setup(); const outcome=await Promise.allSettled([flow.begin(args),flow.begin({...args,reference:'reference_456'})]);
 assert.equal(outcome.filter(r=>r.status==='fulfilled').length,1); assert.equal(counts().creates,1);
 await assert.rejects(flow.begin({...args,projectId:'p2',project:{projectId:'p2'},quote:{currency:'EUR',estimatedAmount:2}}),{status:400});
});
