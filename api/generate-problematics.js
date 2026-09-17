export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'Sujet manquant' });

  // Si clé OpenAI configurée dans Vercel, on l'utilise
  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: "Tu es Trimémo Academic Engine. Pour tout sujet de philo, génère 3 problématiques différentes sous forme de question, avec tension paradoxale, en respectant le programme Bac. Réponds en JSON { problematics: [string][string][string] }" },
            { role: 'user', content: `Sujet: ${subject}` }
          ]
        })
      });
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      if (parsed.problematics) return res.status(200).json(parsed);
    } catch (e) { console.error(e); }
  }

  // Fallback intelligent qui marche pour TOUS les sujets
  const clean = subject.replace(/\?/g,'').trim();
  return res.status(200).json({
    problematics: [
      `${clean} : faut-il y voir une évidence naturelle ou une construction à interroger?`,
      `Dans quelle mesure ${clean.toLowerCase()} nous oblige-t-il à repenser notre rapport au réel?`,
      `Le questionnement "${clean}" révèle-t-il une contradiction interne à la notion même?`
    ]
  });
}
