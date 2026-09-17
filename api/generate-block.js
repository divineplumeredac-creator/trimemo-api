export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{
    const b = typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const {plan, blockIndex=0, problematique, subject, previousBlocks=[]} = b;
    const prompt = `Rédige le bloc ${blockIndex+1} (900 mots) pour: Problématique: ${problematique}, Plan: ${JSON.stringify(plan)}, Sujet: ${subject}, Blocs précédents: ${previousBlocks.slice(-1)}. Style académique expert.`;
    const r = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'user',content:prompt}],temperature:0.7})});
    const d = await r.json();
    return res.status(200).json({block:{title:`Bloc ${blockIndex+1}`, content:d.choices?.[0]?.message?.content||'Contenu généré...', wordCount:900}});
  }catch(e){ return res.status(200).json({block:{title:`Bloc ${e}`,content:`Contenu académique sur ${req.body?.subject||'le sujet'} - 900 mots...`, wordCount:900}, fallback:true});}
}
