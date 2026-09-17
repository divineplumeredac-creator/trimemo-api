export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject, problematique } = req.body || {};
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY manquante' });

  try {
    const system = `Tu es Directeur de mémoire et thèse toutes disciplines confondues.
Tu analyses le sujet pour détecter sa discipline, ses concepts clés et les théories pertinentes.
Tu produis 3 plans ACADÉMIQUES DIFFÉRENTS, détaillés et structurés selon les standards universitaires internationaux (LMD).

Chaque plan doit contenir:
- titre du plan
- problématique reformulée scientifiquement
- 3 PARTIES, chaque partie avec 2 chapitres, chaque chapitre avec 2-3 sous-sections titrées (ex: 1.1, 1.2) + objectif du chapitre
- méthodologie suggérée adaptée à la discipline
- 5 mots-clés

Réponds UNIQUEMENT en JSON valide: { "plans": [ { "title": "...", "problematique_reformulee": "...", "parts": ["PARTIE I:...", "Chapitre 1.1: Titre - Objectif:...", "Chapitre 1.2:...", "PARTIE II:..."], "methodologie": "...", "mots_cles": [] } ] }
Ne cite AUCUN exemple précis dans la consigne. Adapte tout au sujet reçu.`;

    const userPrompt = `Sujet de mémoire/thèse: "${subject}"
Problématique de l'étudiant: "${problematique || subject}"
Discipline: détecte automatiquement.
Génère 3 plans détaillés et différents, respectant les instructions d'un bon plan académique.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await r.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
