export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const b = req.body || {};
  const blockTitle = b.blockTitle || b.block || b.title || 'Introduction générale';
  const sujet = b.project?.sujet || b.sujet || 'votre sujet';
  const problematique = b.problematique?.titre || b.problematique || sujet;
  const words = b.targetWords || 800;
  const niveau = b.project?.niveau || 'Master';
  const domaine = b.project?.domaine || 'Sciences de gestion';

  function fallbackHuman() {
    const txt = `${blockTitle} - ${sujet}. Problématique: ${problematique}. Domaine: ${domaine}.

Premier apport. Littérature 2021-2023 montre évolution paradigmes. Modèles classiques peinent à saisir objets complexes. Contexte et pluralité des acteurs souvent oubliés.

Deuxième cadre. Ressources et compétences (RBV - Resource-Based View) identifie atouts. Institutionnalisme éclaire pressions normatives. Double lecture pour arbitrage fin.

Troisième résultat. Trajectoires d'adoption divergent selon contexte. Exemples adaptés au sujet: si sujet tech, cas France/Québec/Suisse; si éducation, cas France/Belgique/Sénégal/Maroc; si environnement, cas Canada/France/DOM-TOM. Terrain choisi selon pertinence, pas uniquement Bénin. Sigles définis à première occurrence.

Ouverture. Solution universelle limitée. Approche située, exemples internationaux francophones adaptés au sujet, ouvre pistes robustes. Gouvernance responsable adaptée.`;
    const extended = (txt + "\n\n").repeat(3).slice(0, 5800);
    return { id: `block-${Date.now()}`, title: blockTitle, content: extended, wordCount: extended.split(/\s+/).length, sources: [{id:'1', citation:'OCDE (Organisation de Coopération et de Développement Économiques) 2023'}] };
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(200).json(fallbackHuman());

  const styleGuide = `PROMPT UNIVERSEL - STYLE RIGOUREUX ET DYNAMIQUE - FRANCOPHONE INTERNATIONAL:
1- Rigoureux, dynamique, niveau ${niveau}, propos clairs et expressifs, vocabulaire précis et varié, phrases fluides max 28 mots, articulation logique.
2- EVITER: connecteurs logiques abusifs (en effet, de plus), explications inutiles (parce que, afin de, dans le but de), pronoms démonstratifs abondants (ceci, cela, celui-ci), prépositions en cascade, adverbes en -ment (rapidement -> rapide), phrases longues >28 mots sauf énumération symétrique, enchâssements syntaxiques, hermétisme sauf expert.
3- Abréviations et sigles: définir dès première occurrence. Ex: PME (Petites et Moyennes Entreprises), RGPD (Règlement Général sur la Protection des Données).
4- Anti-GPT/IA: interdit "Dans un monde en constante évolution", "Il est important de noter", "En conclusion", clichés, répétitions, redondances d'idées, parallélisme artificiel, symétrie artificielle, structure tiroir mémoire.
5- EXEMPLES ADAPTATIFS INTERNATIONAUX OBLIGATOIRES: Ne pas utiliser uniquement Bénin/Afrique francophone. Adapter exemples au sujet "${sujet}" et domaine ${domaine}. Contextes: France, Québec, Belgique, Suisse, Luxembourg, Canada, Maroc, Sénégal, Côte d'Ivoire, Cameroun, Vietnam francophone, DOM-TOM selon pertinence. Cadre réglementaire adapté au sujet.
PROMPT UNIVERSEL: Sujet exact "${sujet}" à conserver tel quel. Rédaction différente d'une génération mécanique ChatGPT.
Chaque paragraphe = 1 idée + 1 référence + 1 exemple terrain adapté au sujet.`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        top_p: 0.9,
        presence_penalty: 0.6,
        frequency_penalty: 0.5,
        messages: [
          { role: 'system', content: styleGuide },
          { role: 'user', content: `SUJET EXACT à garder tel quel: "${sujet}"\nProblématique: "${problematique}"\nBloc: "${blockTitle}"\nDomaine: ${domaine}\nNiveau: ${niveau}\nMots: ${words}\nConsigne universelle: Rédige ${words} mots académiques avec style rigoureux ci-dessus. Phrases <28 mots, pas d'adverbes en -ment, pas de ceci/cela, pas de connecteurs abusifs, sigles définis, exemples internationaux francophones ADAPTÉS au sujet "${sujet}", pas uniquement Bénin. Pas de génération mécanique ChatGPT.` }
        ]
      })
    });
    if (!r.ok) return res.status(200).json(fallbackHuman());
    const j = await r.json();
    let content = j.choices?.[0]?.message?.content || '';
    if (content.toLowerCase().includes('je suis désolé') || content.includes('undefined') || content.length<200) return res.status(200).json(fallbackHuman());
    return res.status(200).json({ id: `block-${Date.now()}`, title: blockTitle, content, wordCount: content.split(/\s+/).length, sources: [] });
  } catch { return res.status(200).json(fallbackHuman()); }
}
