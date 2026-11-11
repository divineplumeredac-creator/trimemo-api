import test from 'node:test';
import assert from 'node:assert/strict';
import { callClaude } from '../lib/claude-client.js';

test('la limite est transmise et une réponse tronquée reste identifiée', async () => {
  const oldFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'synthetic', stop_reason: 'max_tokens', content: [{type:'text', text:'{"content":"inachevé'}], usage:{} }), {status:200, headers:{'content-type':'application/json'}});
  };
  try {
    const response = await callClaude({apiKey:'synthetic',system:'test',user:'test',maxTokens:16000});
    const result = await response.json();
    assert.equal(request.max_tokens, 16000);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.incomplete_details.reason, 'max_output_tokens');
  } finally { globalThis.fetch = oldFetch; }
});
