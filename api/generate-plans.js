export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  const b = typeof req.body==='string'?JSON.parse(req.body):req.body;

  const SYSTEM_PROMPT = `
Tu es Trimémo Academic Engine.

CHARTE STYLISTIQUE: Français clair, précis, sobre. Pas de répétitions, pas de symétries artificielles, pas de paragraphes génériques.

RÈGLES ABSOLUES:
- N'invente jamais rien
- 3 plans RADICALEMENT DIFFÉRENTS
- Variation obligatoire: Plan A=3 parties 6-7 chapitres, Plan B=2 parties 5-6 chapitres, Plan C=4 parties 6 chapitres
- INTERDIT de répéter même titre dans 2 plans
- INTERDIT "..." ou titres génériques type "Genèse et évolution du champ de..."
- Titres COMPLETS et SPÉCIFIQUES au sujet

Sujet: "${b.subject}" Problématique choisie: "${b.problematique}" Niveau: ${b.niveau}

Génère JSON:
{
  "plans":[
    {
      "title":"Plan A - Approche socio-technique et terrain",
      "introduction":{"titre":"Introduction générale","contenu":"Contexte, problématique, objectifs, méthodologie, annonce du plan","page":1},
      "parties":[
        {"titre":"Partie I -... spécifique","chapitres":[
          {"titre":"Chapitre 1:... titre complet spécifique au sujet","sections":["1.1... spécifique","1.2... spécifique"],"page":3}
        ]}
      ],
      "conclusion":"Conclusion générale",
      "bibliographie":"Bibliographie",
      "annexes":"Annexes",
      "totalPages":40,
      "totalBlocs":20
    }
  ]
}
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
