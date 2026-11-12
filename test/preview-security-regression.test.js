import test from 'node:test';
import assert from 'node:assert/strict';
import generateBlock from '../api/generate-block.js';

process.env.NODE_ENV = 'test';
process.env.TRIMEMO_CLAUDE_API_KEY = 'synthetic';
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';

const project = { projectId: 'projet-test', sujet: 'Sujet fictif', pages: 15, files: [] };
const makeRes = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

async function withMocks(run) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('api.anthropic.com')) {
      const body = JSON.parse(options.body);
      if (body.tools) {
        calls++;
        const content = Array(1300).fill('mot').join(' ') + '.';
        return Response.json({ id: 'synthetic', stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ title: 'Introduction', content, sources: [], footnotes: [] }) }] });
      }
      return new Response('{}', { status: 500 });
    }
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'client-test' });
    if (url.includes('/trimemo_client_projects')) return Response.json([{ project_id: 'projet-test' }]);
    if (url.includes('/trimemo_project_state')) return Response.json([{ owner_id: 'client-test' }]);
    return Response.json([]);
  };
  try { await run(() => calls); } finally { globalThis.fetch = originalFetch; }
}
async function request(body) {
  const res = makeRes();
  await generateBlock({ method: 'POST', headers: { 'x-trimemo-client-token': 'synthetic' }, body: { project, previewMode: true, targetWords: 1250, ...body } }, res);
  return res;
}

test('sécurité : le quota ne doit pas pouvoir être réinitialisé par le navigateur', async () => {
  await withMocks(async (calls) => {
    const first = await request({ previewBlocks: [] });
    assert.equal(first.code, 200);
    const second = await request({ previewBlocks: [] });
    assert.equal(second.code, 402);
    assert.equal(calls(), 1);
  });
});

test('sécurité : la réponse publique ne doit pas dépasser le quota du projet', async () => {
  await withMocks(async () => {
    const res = await request({ previewBlocks: [] });
    assert.equal(res.code, 200);
    assert.ok(res.body.content.trim().split(/\s+/u).length <= 1250);
  });
});
