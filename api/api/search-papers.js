// api/search-papers.js - Universel, zero config
export default async function handler(req, res) {
  // CORS pour Trimémo Universel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { query, limit = 10, year } = req.body;
    if (!query) return res.status(400).json({ error: 'query manquant' });

    // 1. Semantic Scholar (gratuit, sans clé)
    const fields = 'title,authors,year,abstract,url,citationCount,externalIds,venue';
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
    if (year) url += `&year=${year}-`;

    const r = await fetch(url, {
      headers: { 'User-Agent': 'Trimemo/1.0' }
    });
    
    if (!r.ok) throw new Error(`Semantic Scholar ${r.status}`);
    const data = await r.json();

    const papers = (data.data || []).map((p) => ({
      id: p.paperId,
      title: p.title,
      authors: (p.authors || []).map(a => a.name).join(', '),
      year: p.year,
      abstract: p.abstract || '',
      url: p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
      citations: p.citationCount || 0,
      doi: p.externalIds?.DOI || null,
      venue: p.venue || ''
    }));

    return res.status(200).json({
      query,
      count: papers.length,
      papers,
      source: 'semantic-scholar'
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
