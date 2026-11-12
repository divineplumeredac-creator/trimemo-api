// Simulates only the PostgREST row compare-and-swap, never a real database.
export function previewLedgerMock() {
  const rows = new Map();
  return async (input, options = {}) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith('/trimemo_preview_ledger')) return null;
    const method = options.method || 'GET';
    if (method === 'POST') {
      const body = JSON.parse(options.body);
      if (!rows.has(body.project_id)) rows.set(body.project_id, {...body,revision:0,receipts:{},active_token:null,active_until:null});
      return Response.json([]);
    }
    const id = String(url.searchParams.get('project_id') || '').replace(/^eq\./,'');
    const owner = String(url.searchParams.get('owner_id') || '').replace(/^eq\./,'');
    const row = rows.get(id);
    if (!row || row.owner_id !== owner) return Response.json([]);
    if (method === 'GET') return Response.json([structuredClone(row)]);
    if (method === 'PATCH') {
      const revision = Number(String(url.searchParams.get('revision') || '').replace(/^eq\./,''));
      if (row.revision !== revision) return Response.json([]);
      Object.assign(row,JSON.parse(options.body));
      return Response.json([structuredClone(row)]);
    }
    throw new Error(`Unexpected ledger request ${method}`);
  };
}
