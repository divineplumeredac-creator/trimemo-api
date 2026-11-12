import test from 'node:test';
import assert from 'node:assert/strict';
import generateBlock from '../api/generate-block.js';
import recover from '../api/preview-continuation.js';
import { splitPreviewText } from '../lib/preview-continuation.js';
import { calculateQuote, signPricingQuote } from '../lib/pricing.js';
import { createPremiumToken, projectFingerprint } from '../lib/premium-auth.js';

process.env.NODE_ENV = 'test';
process.env.TRIMEMO_CLAUDE_API_KEY = 'synthetic';
process.env.TRIMEMO_PRICING_SECRET = 'synthetic-pricing';
process.env.TRIMEMO_PREMIUM_AUTH_SECRET = 'synthetic-premium';
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
const project = { projectId:'00000000-0000-4000-8000-000000000001', sujet:'Sujet fictif', pages:15, files:[], paymentPlanId:'plan-test', paymentProblematicId:'question-test' };
project.pricingQuoteToken = signPricingQuote(calculateQuote({project}), project);
const result = () => ({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}});

test('sépare à une fin de phrase et reconstitue exactement le contenu', () => {
  const original = 'Première phrase complète.\n\nDeuxième phrase complète. Troisième phrase.';
  const split = splitPreviewText(original, 5);
  assert.equal(split.visible, 'Première phrase complète.');
  assert.equal(split.visible + split.remainder, original);
  assert.deepEqual(splitPreviewText('Une seule phrase longue.', 2), {visible:'', remainder:'Une seule phrase longue.'});
});

test('la suite reste privée et seul le compte avec commande payée peut la récupérer', async () => {
  const oldFetch = globalThis.fetch;
  let saved;
  let userId = 'client-test';
  let refundStatus = 'none';
  const original = Array.from({length:140}, (_,i) => `La phrase ${i} développe correctement un raisonnement académique complet et précis.`).join(' ');
  globalThis.fetch = async (input, options = {}) => {
    const url=String(input);
    if (url.includes('api.anthropic.com')) {
      const body=JSON.parse(options.body);
      if (body.tools) return Response.json({id:'synthetic',stop_reason:'end_turn',usage:{},content:[{type:'text',text:JSON.stringify({title:'Introduction',content:original,sources:[],footnotes:[]})}]});
      return new Response('{}',{status:500});
    }
    if (url.includes('/auth/v1/admin/users/')) return Response.json({id:'client-test'});
    if (url.includes('/auth/v1/user')) return Response.json({id:userId});
    if (url.includes('/trimemo_client_projects')) return Response.json(userId === 'client-test' ? [{project_id:project.projectId,user_id:'client-test'}] : []);
    if (url.includes('/trimemo_project_state')) return Response.json([{owner_id:'client-test'}]);
    if (url.includes('/trimemo_orders?')) return Response.json([{order_id:'commande-test',project_id:project.projectId,project_fingerprint:projectFingerprint(project),status:'paid',refund_status:refundStatus,project_snapshot:{paymentPlanId:'plan-test',paymentProblematicId:'question-test'}}]);
    if (url.includes('/trimemo_preview_continuations')) {
      if (options.method === 'POST') { saved=JSON.parse(options.body); return Response.json([saved]); }
      return Response.json(saved ? [saved] : []);
    }
    return Response.json([]);
  };
  try {
    const res=result();
    const body={project,previewMode:true,targetWords:1250,previewBlocks:[],block:{id:'bloc-test'},plan:{id:'plan-test'},problematic:{id:'question-test'}};
    await generateBlock({method:'POST',headers:{'x-trimemo-client-token':'synthetic'},body},res);
    assert.equal(res.code,200);
    assert.ok(res.body.continuationId);
    assert.equal(res.body.content + saved.remainder,original);
    assert.equal(JSON.stringify(res.body).includes(saved.remainder),false);
    const request={method:'POST',headers:{'x-trimemo-client-token':'synthetic'},body:{project,continuationId:res.body.continuationId,blockId:'bloc-test'}};
    const unpaid=result(); await recover(request,unpaid); assert.equal(unpaid.code,402);
    const paid=result(); await recover({...request,headers:{...request.headers,'x-trimemo-premium-token':createPremiumToken(project,'commande-test')}},paid);
    assert.equal(paid.code,200);
    assert.equal(paid.body.visible + paid.body.remainder,original);
    const wrongBlock=result(); await recover({...request,headers:{...request.headers,'x-trimemo-premium-token':createPremiumToken(project,'commande-test')},body:{...request.body,blockId:'autre'}},wrongBlock);
    assert.equal(wrongBlock.code,403);
    refundStatus = 'refunded';
    const refunded=result(); await recover({...request,headers:{...request.headers,'x-trimemo-premium-token':createPremiumToken(project,'commande-test')}},refunded);
    assert.equal(refunded.code,403);
    refundStatus = 'none'; userId = 'other-client';
    const other=result(); await recover({...request,headers:{...request.headers,'x-trimemo-premium-token':createPremiumToken(project,'commande-test')}},other);
    assert.equal(other.code,403);
  } finally { globalThis.fetch=oldFetch; }
});
