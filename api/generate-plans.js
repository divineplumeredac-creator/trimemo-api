export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { subject, problematique } = req.body || {};
  const s = subject || problematique || "le sujet";

  return res.status(200).json({
    plans: [
      { title: "I. Approche dialectique", parts: [`A. ${s} comme évidence`, `B. Les limites et objections`, `C. Dépassement critique`] },
      { title: "II. Approche analytique", parts: [`A. Analyse conceptuelle de ${s}`, `B. Enjeux anthropologiques`, `C. Portée éthique`] },
      { title: "III. Approche critique", parts: [`A. Déconstruction du préjugé`, `B. Confrontation auteurs (Descartes, Kant, Nietzsche)`, `C. Reconstruction du sens`] }
    ]
  });
}
