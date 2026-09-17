export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject, problematique, plan, blockType } = req.body || {};
  const type = blockType || 'introduction_generale';

  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY manquante' });

  try {
    const system = `Tu es rédacteur académique universel (Licence, Master, Thèse).
Tu t'adaptes AUTOMATIQUEMENT à la discipline du sujet (Droit, Marketing, RH, Finance, Informatique, Sociologie, etc.).
Tu identifies toi-même les auteurs, théories et concepts de référence pertinents pour CE sujet.
Tu rédiges des blocs de 350-600 mots, style universitaire soutenu, avec citations, transitions, et structure académique.
Tu ne répètes jamais de phrase générique type "Ce bloc respecte les consignes". Tu RÉDIGES le vrai contenu.
Réponds en JSON: { "content": "..." }`;

    const userPrompt = `Sujet: "${subject}"
Problématique: "${problematique}"
Plan choisi: "${plan}"
Bloc à rédiger: "${type}"

Consigne: Rédige ce bloc en t'adaptant totalement à la discipline de ce sujet. Si c'est une revue de littérature, cite les auteurs fondateurs DE CETTE DISCIPLINE. Si c'est méthodologie, propose une méthode adaptée à ce sujet. 400 mots minimum.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.65,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }]
      })
    });
    const data = await r.json();
    const content = JSON.parse(data.choices[0].message.content).content || data.choices[0].message.content;

    return res.status(200).json({ content, block: content, type });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
