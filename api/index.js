export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({
    name: 'Trimémo Academic Engine',
    version: '1.0',
    status: 'operational',
    endpoints: ['POST /api/generate-problematics','POST /api/generate-plans','POST /api/generate-block']
  });
}
