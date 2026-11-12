import test from 'node:test';
import assert from 'node:assert/strict';
import generateBlock from '../api/generate-block.js';
import { createOwnerToken } from '../lib/owner-auth.js';
import { calculateQuote, signPricingQuote } from '../lib/pricing.js';
import { previewLedgerMock } from './preview-ledger-mock.js';

process.env.NODE_ENV = 'test';
process.env.TRIMEMO_CLAUDE_API_KEY = 'synthetic';
process.env.TRIMEMO_OWNER_AUTH_SECRET = 'synthetic-secret';
process.env.TRIMEMO_OWNER_EMAIL = 'owner@example.invalid';
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';

function response() {
  return { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

test('la cible suit le plan au-delà de 1 000 mots tout en respectant le quota d’aperçu', async () => {
  const oldFetch = globalThis.fetch;
  const prompts = [];
  const ledger = previewLedgerMock();
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    const ledgerResponse = await ledger(input, options); if (ledgerResponse) return ledgerResponse;
    if (url.includes('api.anthropic.com')) {
      const body = JSON.parse(options.body);
      if (body.tools) {
        prompts.push(JSON.stringify(body.messages));
        return Response.json({ id: 'synthetic', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ title: 'Introduction', content: 'Une phrase complète.', sources: [], footnotes: [] }) }] });
      }
      return new Response('{}', { status: 500 });
    }
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'client-test' });
    if (url.includes('/trimemo_client_projects')) return Response.json([{ project_id: 'projet-test' }]);
    if (url.includes('/trimemo_project_state')) return Response.json([{ owner_id: 'client-test', ...(url.includes('limited-project') ? {state:{blocks:[{status:'done',content:Array(1000).fill('mot').join(' ')}]}} : {}) }]);
    return Response.json([]);
  };
  try {
    const project = { projectId: 'projet-test', sujet: 'Sujet fictif', pages: 30, files: [] };
    project.pricingQuoteToken = signPricingQuote(calculateQuote({ project }), project);
    const owner = response();
    await generateBlock({ method: 'POST', headers: { authorization: `Bearer ${createOwnerToken('owner@example.invalid')}` }, body: { project, ownerMode: true, targetWords: 2400 } }, owner);
    assert.equal(owner.code, 200);
    assert.match(prompts[0], /Environ 2400 mots/);
    const preview = response();
    const ids = {block:{id:'bloc-test'},plan:{id:'plan-test'},problematic:{id:'question-test'}};
    await generateBlock({ method: 'POST', headers: { 'x-trimemo-client-token': 'synthetic' }, body: { project, ...ids, previewMode: true, targetWords: 2400, previewBlocks: [] } }, preview);
    assert.equal(preview.code, 200);
    assert.match(prompts[1], /Environ 2400 mots/);
    const limited = response();
    const existing = { ...project, projectId: 'limited-project' };
    existing.pricingQuoteToken = signPricingQuote(calculateQuote({ project: existing }), existing);
    await generateBlock({ method: 'POST', headers: { 'x-trimemo-client-token': 'synthetic' }, body: { project: existing, ...ids, previewMode: true, targetWords: 2400, previewBlocks: [] } }, limited);
    assert.equal(limited.code, 200);
    assert.match(prompts[2], /Environ 1500 mots/);
    const shortProject = response();
    const short = { ...project, projectId:'short-project', pages: 15 };
    short.pricingQuoteToken = signPricingQuote(calculateQuote({ project: short }), short);
    await generateBlock({ method: 'POST', headers: { 'x-trimemo-client-token': 'synthetic' }, body: { project: short, ...ids, previewMode: true, targetWords: 2400 } }, shortProject);
    assert.equal(shortProject.code, 200);
    assert.match(prompts[3], /Environ 1250 mots/);
  } finally { globalThis.fetch = oldFetch; }
});
