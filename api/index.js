export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  return res.status(200).json({
    ok: true,
    service: "Trimémo Academic Engine",
    api: "/api",
    environment: {
      openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      openaiModelConfigured: Boolean(process.env.OPENAI_MODEL),
      ownerEmailConfigured: Boolean(process.env.TRIMEMO_OWNER_EMAIL),
      ownerPasswordConfigured: Boolean(process.env.TRIMEMO_OWNER_PASSWORD),
      ownerSecretConfigured: Boolean(process.env.TRIMEMO_OWNER_AUTH_SECRET),
    },
    routes: {
      ownerAuth: "/api/owner-auth",
      freePreview: "/api/generate-free-preview",
      problematics: "/api/generate-problematics",
      plans: "/api/generate-plans",
      blocks: "/api/generate-block",
      introductionPreview: "/api/generate-introduction-preview",
      export: "/api/export",
    },
  });
}