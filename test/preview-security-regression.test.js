import test from 'node:test';
import assert from 'node:assert/strict';
import generateBlock from '../api/generate-block.js';
import generateLegacyPreview from '../api/generate-free-preview.js';
import { calculateQuote, signPricingQuote } from '../lib/pricing.js';
import { previewLedgerMock } from './preview-ledger-mock.js';
import { reservePreview, completePreview } from '../lib/preview-ledger.js';

process.env.NODE_ENV = 'test';
process.env.TRIMEMO_CLAUDE_API_KEY = 'synthetic';
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
process.env.TRIMEMO_PRICING_SECRET = 'synthetic-pricing-secret';

const project = { projectId: 'projet-test', sujet: 'Sujet fictif', pages: 15, files: [] };
project.pricingQuoteToken = signPricingQuote(calculateQuote({ project }), project);
const makeRes = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

async function withMocks(run, {dropCommitResponse = false} = {}) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const ledger = previewLedgerMock();
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    const ledgerResponse = await ledger(input, options);
    if (ledgerResponse) {
      if (dropCommitResponse && options.method === 'PATCH' && JSON.parse(options.body).receipts) {
        dropCommitResponse = false;
        throw new Error('synthetic connection interruption after commit');
      }
      return ledgerResponse;
    }
    if (url.includes('api.anthropic.com')) {
      const body = JSON.parse(options.body);
      if (body.tools) {
        calls++;
        const content = Array(130).fill('Une phrase complète possède ici dix mots pour notre vérification.').join(' ');
        return Response.json({ id: 'synthetic', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ title: 'Introduction', content, sources: [], footnotes: [] }) }] });
      }
      return new Response('{}', { status: 500 });
    }
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'client-test' });
    if (url.includes('/trimemo_client_projects')) return Response.json([{ project_id: 'projet-test' }]);
    if (url.includes('/trimemo_project_state')) return Response.json([{ owner_id: 'client-test' }]);
    if (url.includes('/trimemo_preview_continuations') && options.method === 'POST') return Response.json([JSON.parse(options.body)]);
    return Response.json([]);
  };
  try { await run(() => calls); } finally { globalThis.fetch = originalFetch; }
}
async function request(body) {
  const res = makeRes();
  await generateBlock({ method: 'POST', headers: { 'x-trimemo-client-token': 'synthetic' }, body: { project, previewMode: true, targetWords: 1250, block: {id:'bloc-test'}, plan: {id:'plan-test'}, problematic: {id:'question-test'}, ...body } }, res);
  return res;
}

test('un nombre de pages falsifié ne peut pas augmenter le quota', async () => {
  await withMocks(async (calls) => {
    const res = await request({ project: { ...project, pages: 300 }, previewBlocks: [] });
    assert.equal(res.code, 403);
    assert.equal(calls(), 0);
  });
});

test('sécurité : le quota ne doit pas pouvoir être réinitialisé par le navigateur', async () => {
  await withMocks(async (calls) => {
    const first = await request({ previewBlocks: [] });
    assert.equal(first.code, 200);
    const second = await request({ previewBlocks: [], block: {id:'autre-bloc'} });
    assert.equal(second.code, 402);
    assert.equal(calls(), 1);
  });
});

test('un bloc retrouvé après une interruption ne provoque pas un nouvel appel au moteur', async () => {
  await withMocks(async (calls) => {
    const first = await request({previewBlocks:[]});
    const retry = await request({previewBlocks:[]});
    assert.equal(first.code,200);
    assert.equal(retry.code,200);
    assert.deepEqual(retry.body,first.body);
    assert.equal(calls(),1);
  });
});

test('une réponse perdue après sauvegarde permet de retrouver le bloc sans régénération', async () => {
  await withMocks(async (calls) => {
    const interrupted = await request({previewBlocks:[]});
    assert.equal(interrupted.code,500);
    const recovered = await request({previewBlocks:[]});
    assert.equal(recovered.code,200);
    assert.ok(recovered.body.continuationId);
    assert.equal(calls(),1);
  }, {dropCommitResponse:true});
});

test('deux générations simultanées ne consomment pas deux fois le quota', async () => {
  await withMocks(async (calls) => {
    const [a,b] = await Promise.all([request({block:{id:'premier'}}),request({block:{id:'deuxieme'}})]);
    assert.deepEqual([a.code,b.code].sort(),[200,409]);
    assert.equal(calls(),1);
  });
});

test('sécurité : la réponse publique ne doit pas dépasser le quota du projet', async () => {
  await withMocks(async () => {
    const res = await request({ previewBlocks: [] });
    assert.equal(res.code, 200);
    assert.ok(res.body.content.trim().split(/\s+/u).length <= 1250);
  });
});

test('l’ancien chemin d’aperçu respecte le même quota que la rédaction par blocs', async () => {
  await withMocks(async (calls) => {
    const reservation = await reservePreview({projectId:project.projectId,ownerId:'client-test',blockId:'previous',planId:'plan-test',problematicId:'question-test',limit:1250});
    await completePreview(reservation,{response:{content:'aperçu'},visible:Array(1250).fill('mot').join(' '),remainder:'',blockId:'previous',planId:'plan-test',problematicId:'question-test'});
    const res = makeRes();
    await generateLegacyPreview({method:'POST',headers:{'x-trimemo-client-token':'synthetic'},body:{project}},res);
    assert.equal(res.code,402);
    assert.equal(calls(),0);
  });
});
