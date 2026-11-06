import { setCors } from "../lib/http.js";

function cors(res, req) { setCors(res, req, "GET, POST, OPTIONS"); }
function fail(res, status, error) { return res.status(status).json({ error }); }
function config() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) { const error = new Error("Le stockage Supabase n'est pas configuré."); error.status = 503; throw error; }
  return { url, key };
}
async function db(path, init = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
  const raw = await response.text();
  if (!response.ok) {
    const error = new Error("Supabase REST HTTP " + response.status + ": " + raw.slice(0, 180));
    error.status = response.status === 404 ? 503 : 502;
    throw error;
  }
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function getBearer(req) {
  const value = String(req.headers?.authorization || req.headers?.Authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : "";
}
async function authorizeProject(req, id) {
  const token = getBearer(req);
  if (!token) { const error = new Error("Connectez-vous pour accéder à ce projet."); error.status = 401; throw error; }
  const { url, key } = config();
  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000),
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) { const error = new Error("Votre session a expiré. Connectez-vous à nouveau."); error.status = 401; throw error; }
  const query = new URLSearchParams({ select: "project_id", project_id: "eq." + id, user_id: "eq." + user.id, limit: "1" });
  const membership = await db("trimemo_client_projects?" + query);
  if (!Array.isArray(membership) || !membership.length) { const error = new Error("Ce projet n'est pas rattaché à votre compte client."); error.status = 403; throw error; }
  return user;
}
function projectId(req) {
  const value = String(req.method === "GET" ? req.query?.projectId : req.body?.projectId || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return fail(res, 405, "Utilisez GET ou POST.");
  const id = projectId(req);
  if (!id) return fail(res, 400, "Identifiant de projet invalide.");
  try {
    await authorizeProject(req, id);
    if (req.method === "GET") {
      const rows = await db(`trimemo_project_state?project_id=eq.${encodeURIComponent(id)}&select=project_id,state,updated_at,expires_at&limit=1`);
      const row = rows?.[0];
      if (!row) return res.status(200).json({ success: true, found: false });
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
        await db(`trimemo_project_state?project_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
        return res.status(200).json({ success: true, found: false });
      }
      return res.status(200).json({ success: true, found: true, state: row.state, updatedAt: row.updated_at });
    }
    const state = req.body?.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) return fail(res, 400, "État du projet invalide.");
    if (JSON.stringify(state).length > 2_000_000) return fail(res, 413, "Le projet est trop volumineux pour être sauvegardé en une seule fois.");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
    await db("trimemo_project_state?on_conflict=project_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ project_id: id, state, updated_at: now.toISOString(), expires_at: expiresAt }),
    });
    return res.status(200).json({ success: true, savedAt: now.toISOString() });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("TRIMEMO_PROJECT_STATE_FAILED", { method: req.method, status, message: String(error?.message || "unknown").slice(0, 180) });
    return fail(res, status >= 400 && status < 500 ? status : 502, status === 503 ? "Le stockage Supabase n'est pas configuré ou la table est absente." : status === 401 || status === 403 ? error.message : "Impossible de sauvegarder ou récupérer le projet.");
  }
}
