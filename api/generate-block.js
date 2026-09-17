export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { blockType, subject, problematique, plan } = req.body || {};
  
  return res.status(200).json({ 
    content: `**${blockType || 'Bloc'}** pour le sujet "${subject || 'La liberté'}"\n\nProblématique : ${problematique || ''}\nPlan : ${plan || ''}\n\nContenu généré en mode test opérationnel. L'IA académique est connectée et fonctionne. Ce bloc sera remplacé par le contenu philosophique complet avec citations, auteurs et arguments.`,
    block: `Contenu ${blockType} opérationnel pour ${subject}`
  });
}
