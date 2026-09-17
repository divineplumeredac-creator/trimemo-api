export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  try{
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body || {};
    const subject = body.subject || body.topic || body.query || body.q || body.sujet || '';
    const sources = body.sources || [];
    if(!subject) return res.status(400).json({error:'subject manquant'});

    const prompt = `Tu es un directeur de mémoire expert. Sujet: "${subject}". Consignes: ${body.consignes||''}. Niveau: ${body.niveau||'Master'}. Sources: ${sources.slice(0,3).map(s=>s.title).join('; ')}.
Génère 3 problématiques académiques originales, critiques, actuelles. Réponds en JSON: {"problematiques":["...","...","..."]}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body: JSON.stringify({model:'gpt-4o-mini', messages:[{role:'user',content:prompt}], temperature:0.7, response_format:{type:'json_object'}})
    });
    const data = await r.json();
    const content = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return res.status(200).json({problematiques: content.problematiques || content.problematics || []});
  }catch(e){
    return res.status(200).json({problematiques:[
      `Dans quelle mesure ${req.body?.subject||'le sujet'} redéfinit-il les cadres normatifs contemporains?`,
      `Comment ${req.body?.subject||'le sujet'} s'articule-t-il avec les transformations sociales observées depuis 2020?`,
      `En quoi ${req.body?.subject||'le sujet'} constitue-t-il un révélateur des tensions épistémologiques actuelles?`
    ], fallback:true});
  }
}
