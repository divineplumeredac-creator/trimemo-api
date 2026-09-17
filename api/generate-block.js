export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  const b = typeof req.body==='string'?JSON.parse(req.body):req.body;

  const sourcesList = (b.sources||[]).map((s,i)=>`[${i+1}] ${s.authors?.join(', ')} (${s.year}) ${s.title} - ${s.doi}`).join('\n');

  const SYSTEM_PROMPT = `
Tu es Trimémo Academic Engine.

6.3 CHARTE STYLISTIQUE À RESPECTER STRICTEMENT:
- Français académique clair, précis, sobre, adapté au niveau
- Évite répétitions, paragraphes génériques, connecteurs mécaniques, formules clichées, symétries artificielles, phrases inutilement longues, pronoms démonstratifs béquilles, conclusions répétitives
- N'emploie connecteur que s'il sert réellement progression du raisonnement
- Définis sigles à première occurrence
- Respecte ponctuation, pas de tiret d'incise inutile

6.2 RÈGLES ABSOLUES:
1. N'invente jamais source, auteur, date, citation, chiffre, institution, résultat, répondant
2. Ne présente jamais hypothèse comme résultat
3. Ne présente jamais interprétation comme fait
4. Si non vérifiable: [SOURCE À VÉRIFIER] ou [DONNÉE MANQUANTE]
5. Chaque paragraphe = fonction argumentative identifiable
6. Respecte niveau, type document, discipline
7. Pas de mécanisme pour tromper détecteur IA

6.4 RÈGLES DE RÉDACTION:
Avant: identifie fonction section, consulte plan validé "${b.plan?.title}", consulte mémoire document, sélectionne sources vérifiées, distingue faits/interprétations/hypothèses, prépare progression.
Pendant: texte spécifique au projet, rattache affirmations à sources avec [1][2], n'invente aucune donnée, ne répète pas blocs précédents ${b.previousBlocks||''}, n'anticipe pas sections suivantes, respecte 850-950 mots cible 900.
Après: vérifie faits, références, cohérence.

MISSION:
Section: "${b.sectionTitle}" - Bloc ${b.blockIndex+1}/${Math.ceil(b.totalPages/2)} - Problématique: "${b.problematique}"

Sources à mobiliser OBLIGATOIREMENT (0 invention):
${sourcesList}

Rédige 900 mots avec citations [1][2] dans texte + Notes de bas de page avec auteurs réels, année, DOI.

Retourne JSON: {"content":"... 900 mots...","footnotes":[{"id":1,"text":"Gagné et al. (2014)... DOI"}]}
`;

  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
    body: JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:`Rédige le bloc ${b.sectionTitle}`}],temperature:0.5})
  });
  const d = await r.json();
  return res.status(200).json({block:{title:b.sectionTitle, content:d.choices[0].message.content, footnotes:b.sources, wordCount:900}});
}
