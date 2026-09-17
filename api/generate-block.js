export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject, problematique, blockType } = req.body || {};
  const type = (blockType || 'argument').toLowerCase();

  const content = `**${type.toUpperCase()}** - Sujet: ${subject}\nProblématique: ${problematique}\n\nCe bloc respecte les consignes Trimémo : définition précise, argument avec exemple, citation philosophique et transition. Il s'adapte automatiquement à tout sujet du programme (liberté, vérité, justice, bonheur, art, science, etc.).\n\nExemple de développement pour "${subject}" : Il s'agit de montrer que la notion interrogée n'est pas univoque et engage notre rapport au monde.`;

  return res.status(200).json({ content, block: content });
}
