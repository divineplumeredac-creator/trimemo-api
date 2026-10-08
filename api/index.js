export default function handler(req, res) {
  const origin = String(req.headers?.origin || "").trim().replace(/\/$/, "");
  const allowed = origin === "https://trimemo-frontend.vercel.app" || /^https:\/\/trimemo-frontend-[a-z0-9-]+\.vercel\.app$/i.test(origin) ? origin : "https://trimemo-frontend.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", allowed);
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
      premiumSecretConfigured: Boolean(process.env.TRIMEMO_PREMIUM_AUTH_SECRET || process.env.TRIMEMO_OWNER_AUTH_SECRET),
      sharedRateLimitConfigured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      frontendOriginConfigured: Boolean(process.env.TRIMEMO_FRONTEND_URL),
      paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
      paypalEnv: String(process.env.PAYPAL_ENV || "sandbox"),
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