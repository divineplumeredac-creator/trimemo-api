export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const query = req.body?.query || req.query?.q;
  if (!query) return res.status(400).json({ error: 'query manquant' });

  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=20&fields=title,authors,year,abstract,url,externalIds,citationCount,venue`;
    
    const r = await fetch(url, {
      headers: { 'x-api-key': process.env.SEMANTIC_SCHOLAR_KEY || '' }
    });
    
    const data = await r.json();
    if (!data.data) return res.status(200).json({ papers: [], count: 0 });

    const papers = data.data.map(p => ({
      id: p.paperId,
      title: p.title || 'Sans titre',
      authors: p.authors?.map(a => a.name).join(', ') || 'Auteur inconnu',
      year: p.year || new Date().getFullYear(),
      abstract: p.abstract ? p.abstract.slice(0,350)+'...' : '',
      url: p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
      venue: p.venue || '',
      citationCount: p.citationCount || 0,
      bibtexKey: `${(p.authors?.[0]?.name.split(' ').pop() || 'Author').replace(/[^a-zA-Z]/g,'')}${p.year || '2024'}${(p.title?.split(' ')[0] || 'Paper').replace(/[^a-zA-Z]/g,'')}`
    }));

    return res.status(200).json({ papers, count: papers.length });
  } catch(e) {
    return res.status(500).json({ error: e.message, papers: [] });
  }
}
