function fail(status, message) { return Object.assign(new Error(message), { status }); }

// This check is deliberately independent of the project and payment data sent by the browser.
export async function requireClientProject(req, projectId) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || req.headers?.Authorization || ""));
  if (!match) throw fail(401, "Connectez-vous pour accéder à ce projet.");
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw fail(503, "Le service de comptes est indisponible.");
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${match[1]}` }, signal: AbortSignal.timeout(8000) });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user.id) throw fail(401, "Votre session a expiré. Reconnectez-vous.");
  if (user.app_metadata?.trimemo_access === "suspended" || (user.banned_until && Date.parse(user.banned_until) > Date.now())) throw fail(403, "Ce compte est suspendu.");
  const query = new URLSearchParams({ select: "project_id", project_id: `eq.${projectId}`, user_id: `eq.${user.id}`, limit: "1" });
  const response = await fetch(`${url}/rest/v1/trimemo_client_projects?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw fail(503, "La vérification du projet est indisponible.");
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1) throw fail(403, "Ce projet n'appartient pas à votre compte.");
  return user;
}
