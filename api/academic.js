function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

export default function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });

  const action = String(req.query?.action || req.body?.action || "");
  const supported = ["create-paypal-order", "create-mobile-money", "verify-paypal", "verify-mobile-money", "generate-premium"];
  if (!supported.includes(action)) return res.status(400).json({ error: "Action académique inconnue." });

  return res.status(501).json({
    error: `L'action ${action} n'est pas encore connectée à un prestataire de paiement ou à un workflow premium sécurisé.`,
    code: "ACADEMIC_ACTION_NOT_CONFIGURED",
    action,
  });
}
