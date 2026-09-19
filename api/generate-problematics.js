  export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const body = req.body || {};
  const sujet = (body.sujet || 'votre sujet').trim().slice(0,400);
  const domaine = body.domaine || 'Sciences de gestion';
  const niveau = body.niveau || 'Master';
  const typeDoc = body.typeDoc || 'Mémoire';

  function fallback() {
    return [
      {
        titre: `Dans quelle mesure ${sujet} redéfinit-il les stratégies d'innovation dans ${domaine} ?`,
        texte: `Analyse critique de ${sujet}. Tension performance/durabilité, adoption rapide vs résistance. Études de cas comparées choisies selon sujet : contexte francophone international (France, Québec, Belgique, Suisse, Afrique francophone, Caraïbes, Asie francophone) selon pertinence du sujet.`,
        angle: "Analytique et critique",
        score: 9.2,
        pertinence: "Angle différenciant, exemples adaptés au sujet."
      },
      {
        titre: `Quels déterminants expliquent l'adoption de ${sujet} en contexte francophone international ?`,
        texte: `Terrain mixte, freins et leviers adaptés au sujet. Questionnaire n=200 + 15 entretiens. Terrain choisi selon sujet : si sujet éducation -> France/Québec/Sénégal, si tech -> France/Canada/Côte d'Ivoire, si environnement -> France/Canada/DOM-TOM. Modèle prédictif contextualisé.`,
        angle: "Empirique - international adaptatif",
        score: 8.8,
        pertinence: "Données primaires, exemples adaptés."
      },
      {
        titre: `Comment articuler éthique, régulation et performance autour de ${sujet} : vers un cadre intégratif pour ${domaine} ?`,
        texte: `Normatif prospectif. Dilemmes éthiques et réglementaires selon sujet : RGPD (Règlement Général sur la Protection des Données) Europe, Loi canadienne, cadres africains. Proposition cadre intégratif avec illustrations adaptées au sujet, pas uniquement Bénin.`,
        angle: "Normatif prospectif - international",
        score: 9.0,
        pertinence: "Prospective utile, cadre adapté au sujet."
      }
    ];
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(200).json({ problematiques: fallback() });

  const styleGuide = `
STYLE RIGOUREUX ET DYNAMIQUE - PLATEFORME FRANCOPHONE INTERNATIONALE - PROMPT UNIVERSEL:
1- Style académique rigoureux et dynamique: niveau adapté ${niveau}, propos clairs et expressifs, vocabulaire précis et varié, phrases fluides max 28 mots, articulation logique.
2- EVITER: connecteurs logiques abusifs (en effet, de plus), explications inutiles (parce que, afin de, dans le but de), pronoms démonstratifs abondants (ceci, cela, celui-ci), prépositions en cascade, adverbes en -ment (rapidement -> rapide), phrases longues >28 mots sauf énumération symétrique, enchâssements syntaxiques, hermétisme sauf expert.
3- Abréviations et sigles: définir dès première occurrence. Ex: PME (Petites et Moyennes Entreprises), RGPD (Règlement Général...), UTAUT (Unified Theory...).
4- Anti-GPT/IA: interdit "Dans un monde en constante évolution", "Il est important de noter", "En conclusion", "Il convient de souligner", répétitions, redondances, parallélisme artificiel, clichés, symétrie artificielle, structure tiroir mémoire.
5- EXEMPLES ADAPTATIFS INTERNATIONAUX: INTERDIT uniquement Bénin/Afrique francophone. Adapter au SUJET "${sujet}", domaine ${domaine}. Contexte francophone international varié: France, Québec, Belgique, Suisse, Maroc, Sénégal, Côte d'Ivoire, Canada, Luxembourg, Cameroun, Vietnam francophone, DOM-TOM selon pertinence. Cadre réglementaire adapté (RGPD, Loi québécoise Loi 25).
PROMPT UNIVERSEL: Toujours garder SUJET EXACT "${sujet}" tel quel dans chaque titre.
`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.82,
        top_p: 0.9,
        presence_penalty: 0.6,
        frequency_penalty: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: styleGuide },
          { role: 'user', content: `SUJET EXACT à conserver tel quel: "${sujet}"\nDomaine: ${domaine}\nNiveau: ${niveau}\nType: ${typeDoc}\nGénère 3 problématiques JSON avec sujet exact dedans, exemples internationaux adaptés au sujet, 80 mots max, phrases courtes <28 mots, sans adverbes en -ment, sans ceci/cela, sigles définis, pas de structure tiroir.` }
        ]
      })
    });
    if (!r.ok) return res.status(200).json({ problematiques: fallback() });
    const j = await r.json();
    let parsed; try { parsed = JSON.parse(j.choices?.[0]?.message?.content||'{}'); } catch { return res.status(200).json({ problematiques: fallback() }); }
    let list = parsed.problematiques || [];
    if (!Array.isArray(list) || list.length<3) list = fallback();
    list = list.slice(0,3).map(p => {
      let t = (p.titre||'').toString();
      if (!t.toLowerCase().includes(sujet.toLowerCase().slice(0,8))) t = t + ` : cas de ${sujet}`;
      return { titre: t, texte: (p.texte||'').toString(), angle: (p.angle||'').toString(), score: p.score||9.0, pertinence: (p.pertinence||'').toString() };
    });
    return res.status(200).json({ problematiques: list });
  } catch { return res.status(200).json({ problematiques: fallback() }); }
  }
