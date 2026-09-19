export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  const body=req.body||{};
  const problematique=body.problematique?.titre||body.problematique||body.sujet||'Problématique';
  const sujet=body.sujet||body.project?.sujet||problematique;
  const domaine=body.domaine||body.project?.domaine||'Sciences de gestion';
  function fallback(){
    return [
      { id:'plan-a', titre:`Plan A - Critique : ${sujet.slice(0,50)}`, description:'Théorique ancré international adaptatif', approche:'Critique', totalWords:12000, originalite:'Grille inédite', chapters:[
        {title:'Chapitre 1: Fondements ancrés', subparts:['1.1 Définition située (contexte adapté au sujet)','1.2 Revue PRISMA (Preferred Reporting Items for Systematic Reviews and Meta-Analyses)'], wordCount:3000, sources:[]},
        {title:'Chapitre 2: Tensions et modèle', subparts:['2.1 Tensions terrain adaptées','2.2 Modèle conceptuel'], wordCount:3000, sources:[]},
        {title:'Chapitre 3: Discussion', subparts:['3.1 Ruptures','3.2 Apports'], wordCount:3000, sources:[]},
        {title:'Chapitre 4: Gouvernance', subparts:['4.1 Recommandations adaptées au sujet','4.2 Limites assumées'], wordCount:3000, sources:[]}
      ]},
      { id:'plan-b', titre:`Plan B - Terrain international : ${sujet.slice(0,50)}`, description:'Mixte n=200+15 entretiens, exemples adaptés', approche:'Empirique', totalWords:12000, originalite:'Données primaires', chapters:[
        {title:'Chapitre 1: Contexte international francophone adapté au sujet', subparts:['1.1 Contexte selon sujet','1.2 Problématisation'], wordCount:3000, sources:[]},
        {title:'Chapitre 2: Méthodo mixte', subparts:['2.1 Questionnaire','2.2 Entretiens'], wordCount:3000, sources:[]},
        {title:'Chapitre 3: Résultats', subparts:['3.1 Quanti','3.2 Quali'], wordCount:3000, sources:[]},
        {title:'Chapitre 4: Modèle', subparts:['4.1 Modèle prédictif','4.2 Recommandations internationales'], wordCount:3000, sources:[]}
      ]},
      { id:'plan-c', titre:`Plan C - Prospectif 2030 : ${sujet.slice(0,50)}`, description:'3 scénarios + cadre responsable adaptatif', approche:'Prospectif', totalWords:12000, originalite:'Scénarios contrastés', chapters:[
        {title:'Chapitre 1: Enjeux éthiques internationaux adaptés', subparts:['1.1 Dilemmes selon sujet','1.2 Attentes sociétales'], wordCount:3000, sources:[]},
        {title:'Chapitre 2: Méthodo prospective', subparts:['2.1 Delphi','2.2 Ateliers prospectifs'], wordCount:3000, sources:[]},
        {title:'Chapitre 3: Trois scénarios 2030', subparts:['3.1 Tendanciel','3.2 Souhaitable','3.3 Rupture'], wordCount:3000, sources:[]},
        {title:'Chapitre 4: Cadre responsable adapté au sujet', subparts:['4.1 Principes','4.2 Feuille de route opérationnelle'], wordCount:3000, sources:[]}
      ]}
    ];
  }
  const key=process.env.OPENAI_API_KEY;
  if (!key) return res.status(200).json({plans:fallback()});
  try{
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:'gpt-4o-mini',temperature:0.84,response_format:{type:'json_object'},messages:[{role:'system',content:`PROMPT UNIVERSEL - STYLE RIGOUREUX ET DYNAMIQUE: Niveau adapté, propos clairs, vocabulaire précis et varié, phrases fluides max 28 mots, articulation logique. EVITER: connecteurs abusifs, explications inutiles, pronoms démonstratifs ceci/cela, prépositions en cascade, adverbes en -ment, phrases longues, enchâssements, hermétisme. Sigles définis première occurrence. Anti-GPT: pas de clichés IA, pas de répétitions, pas de symétrie artificielle, pas de plan tiroir. EXEMPLES ADAPTATIFS INTERNATIONAUX: pas uniquement Bénin. Adapter au sujet "${sujet}", domaine ${domaine}. Contextes: France, Québec, Belgique, Suisse, Canada, Afrique francophone, Caraïbes, Asie francophone selon sujet.`},{role:'user',content:`Problématique:${problematique}\nSujet exact:${sujet}\nDomaine:${domaine}\nGénère 3 plans A/B/C avec sujet exact, 4 chapitres x 3000 mots, exemples internationaux adaptés, JSON strict, sigles définis.`}]})});
    if (!r.ok) return res.status(200).json({plans:fallback()});
    const j=await r.json();
    let p; try{p=JSON.parse(j.choices?.[0]?.message?.content||'{}');}catch{return res.status(200).json({plans:fallback()});}
    let plans=p.plans||[]; if (!Array.isArray(plans)||plans.length<2) plans=fallback();
    return res.status(200).json({plans:plans.slice(0,3)});
  }catch{return res.status(200).json({plans:fallback()});}
}
