export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{
    const b = typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const problematique = b.problematique || b.question || '';
    const subject = b.subject || b.topic || '';
    const prompt = `Problématique: "${problematique}". Sujet: "${subject}". Génère 3 plans détaillés en JSON: {"plans":[{"title":"...","sections":["I...","II...","III..."]},...]}`;
    const r = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'user',content:prompt}],temperature:0.7,response_format:{type:'json_object'}})});
    const d = await r.json();
    const c = JSON.parse(d.choices?.[0]?.message?.content||'{}');
    return res.status(200).json({plans:c.plans||[]});
  }catch(e){ return res.status(200).json({plans:[
    {title:"Plan analytique",sections:["I. Cadre théorique","II. Analyse empirique","III. Discussion"]},
    {title:"Plan comparatif",sections:["I. État de l'art","II. Comparaison","III. Recommandations"]},
    {title:"Plan dialectique",sections:["I. Thèse","II. Antithèse","III. Synthèse"]}
  ], fallback:true});}
}
