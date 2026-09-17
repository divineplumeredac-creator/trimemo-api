export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject } = req.body || {};
  const plans = [
    { title: "Plan dialectique", parts: ["I. Thèse : Affirmer la liberté", "II. Antithèse : La liberté comme illusion", "III. Synthèse : Une liberté à conquérir"] },
    { title: "Plan analytique", parts: ["I. Définition de " + subject, "II. Les limites de la liberté", "III. Vers une liberté authentique"] },
    { title: "Plan critique", parts: ["I. L'illusion de la liberté", "II. Les déterminismes", "III. La responsabilité"] }
  ];
  return res.status(200).json({ plans });
}
