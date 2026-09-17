export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject, problematique } = req.body || {};
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY manquante' });

  try {
    const system = `Tu es Directeur de mémoire expert (Master, Thèse). Tu conçois des plans détaillés et académiques.
Pour tout sujet de mémoire/thèse, tu dois produire 3 PROPOSITIONS DE PLANS DIFFÉRENTS.

Chaque plan doit respecter les instructions d'un bon plan académique:
- Un titre académique
- 3 parties principales
- Chaque partie = 2 à 3 chapitres
- Chaque chapitre = 2 à 3 sous-sections (1.1, 1.2) avec objectif précis
- Méthodologie suggérée
- Intérêt scientifique

Réponds OBLIGATOIREMENT en JSON valide comme ceci:
{
  "plans": [
    {
      "title": "Plan 1: Approche Classique IMRAD Adaptée",
      "problematique_reformulee": "...",
      "parts": [
        "PARTIE I: CADRE THÉORIQUE - Revue de littérature sur la motivation",
        "Chapitre 1.1: Théories de la motivation (Maslow, Herzberg, Vroom) - Objectif: définir les concepts",
        "Chapitre 1.2: Le concept de rendement / performance en entreprise",
        "PARTIE II: CADRE MÉTHODOLOGIQUE ET EMPIRIQUE",
        "Chapitre 2.1: Méthodologie de recherche (qualitative/quantitative) et terrain d'étude",
        "Chapitre 2.2: Outils de collecte et d'analyse des données",
        "PARTIE III: RÉSULTATS, ANALYSE ET RECOMMANDATIONS",
        "Chapitre 3.1: Présentation et analyse des résultats - lien motivation-rendement",
        "Chapitre 3.2: Discussion, limites et recommandations managériales"
      ],
      "methodologie": "Questionnaires + entretiens semi-directifs",
      "mots_cles": ["motivation", "rendement", "performance"]
    }
  ]
}`;

    const userPrompt = `Sujet de mémoire/thèse: ${subject}
Problématique: ${problematique || subject}

Génère 3 plans détaillés différents (Classique, Thématique, Analytique) pour ce sujet. Sois très détaillé, chaque chapitre doit avoir un objectif.`;

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
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    return res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
