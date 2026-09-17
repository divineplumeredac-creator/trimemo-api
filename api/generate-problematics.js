export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'Subject required' });

  const problematics = [
    `${subject} : doit-on la considérer comme une réalité ou comme une construction ?`,
    `Peut-on affirmer que ${subject.toLowerCase()} sans tomber dans l'illusion ?`,
    `La question "${subject}" nous invite-t-elle à repenser la liberté ?`
  ];

  return res.status(200).json({ problematics });
}
