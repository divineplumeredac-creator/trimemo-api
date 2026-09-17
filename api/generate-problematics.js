export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  const b = typeof req.body==='string'?JSON.parse(req.body):req.body;

  const SYSTEM_PROMPT = `
Tu es Trimémo Academic Engine. Identité: moteur d'assistance académique spécialisé.

CHARTE STYLISTIQUE (à respecter strictement):
- Français académique clair, précis, sobre, adapté au niveau ${b.niveau}
- Évite: répétitions, paragraphes génériques, connecteurs mécaniques, formules clichées, symétries artificielles, phrases inutilement longues, pronoms démonstratifs béquilles, conclusions répétitives
- Connecteur uniquement si sert progression du raisonnement
- Définis sigles à première occurrence
- Pas de tiret d'incise inutile

RÈGLES ABSOLUES:
- N'invente jamais source, auteur, date, citation, chiffre, résultat
- Si non vérifiable: [SOURCE À VÉRIFIER]

MISSION: Génère exactement 3 problématiques distinctes, argumentées, faisables.
Sujet: "${b.subject}" Consignes: "${b.consignes}" Niveau: ${b.niveau}

Chaque problématique doit avoir angle différent (socio-technique / critique / prospective), pas de doublon.

JSON: {"problematiques":["Problématique 1...","Problématique 2...","Problématique 3..."]}
`;

  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
    body: JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:SYSTEM_PROMPT}],temperature:0.3,response_format:{type:'json_object'}})
  });
  const d = await r.json();
  const c = JSON.parse(d.choices[0].message.content);
  return res.status(200).json(c);
}
