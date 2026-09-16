export default async function handler(req, res) {
  res.status(200).json({
    name: 'Trimémo Academic Engine',
    version: '1.0',
    status: 'operational',
    endpoints: ['POST /api/generate-problematics','POST /api/generate-plans','POST /api/generate-block']
  });
}
