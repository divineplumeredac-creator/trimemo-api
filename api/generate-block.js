export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject, problematique, plan, blockType } = req.body || {};
  const type = blockType || 'introduction';

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY manquante' });
  }

  try {
    const system = `Tu es Trimémo Academic Engine, professeur de philo niveau Bac/Prépa. Tu rédiges un seul bloc de dissertation selon la méthode Trimémo.
Consignes strictes:
- 180 à 250 mots
- Style académique français, rigoureux
- Une citation d'auteur précise avec nom et ouvrage
- Un exemple concret
- Transition vers la suite
- Ne répète jamais "Ce bloc respecte les consignes" - RÉDIGE le vrai contenu.`;

    const userPrompt = `Sujet: ${subject}
Problématique: ${problematique}
Plan retenu: ${plan || 'Plan dialectique'}
Bloc à rédiger maintenant: ${type.toUpperCase()}

Rédige uniquement ce bloc. Si c'est INTRODUCTION: accroche + définition + problématisation + annonce de plan.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }]
      })
    });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    return res.status(200).json({ content, block: content });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
