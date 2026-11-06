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
    const error = new Error("Supabase REST HTTP " + response.status);
    error.status = response.status === 404 ? 503 : 502;
    throw error;
  }
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function projectId(req) {
  const value = String(req.method === "GET" ? req.query?.projectId : req.body?.projectId || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}
async function authenticate(token) {
  if (!token) { const error = new Error("Connectez-vous pour accéder à la sauvegarde de ce projet."); error.status = 401; throw error; }
  const { url, key } = config();
  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000),
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) { const error = new Error("Session client invalide. Reconnectez-vous."); error.status = 401; throw error; }
  return user;
}
async function assertMembership(userId, id) {
  const rows = await db("trimemo_client_projects?user_id=eq." + encodeURIComponent(userId) + "&project_id=eq." + encodeURIComponent(id) + "&select=project_id&limit=1");
  if (!rows?.length) { const error = new Error("Ce projet n'est pas rattaché à votre compte client."); error.status = 403; throw error; }
}
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return fail(res, 405, "Utilisez GET ou POST.");
  const id = projectId(req);
  if (!id) return fail(res, 400, "Identifiant de projet invalide.");
  try {
    const token = String(req.method === "GET" ? req.headers.authorization || "" : req.body?.token || "").replace(/^Bearer\s+/i, "").trim();
    const user = await authenticate(token);
    await assertMembership(user.id, id);
    if (req.method === "GET") {
      const rows = await db("trimemo_project_state?project_id=eq." + encodeURIComponent(id) + "&select=project_id,owner_id,state,updated_at,expires_at&limit=1");
      const row = rows?.[0];
      if (!row) return res.status(200).json({ success: true, found: false });
      if (row.owner_id !== user.id) return fail(res, 403, "Cette sauvegarde n'appartient pas à votre compte.");
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
        await db("trimemo_project_state?project_id=eq." + encodeURIComponent(id) + "&owner_id=eq." + encodeURIComponent(user.id), { method: "DELETE" });
        return res.status(200).json({ success: true, found: false });
      }
      return res.status(200).json({ success: true, found: true, state: row.state, updatedAt: row.updated_at });
    }
    const state = req.body?.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) return fail(res, 400, "État du projet invalide.");
    if (String(state?.project?.projectId || "") !== id) return fail(res, 400, "L'identifiant du projet ne correspond pas à son contenu.");
    const serialized = JSON.stringify(state);
    if (serialized.length > 2_000_000) return fail(res, 413, "Le projet est trop volumineux pour être sauvegardé en une seule fois.");
    const existing = await db("trimemo_project_state?project_id=eq." + encodeURIComponent(id) + "&select=owner_id&limit=1");
    if (existing?.[0]?.owner_id && existing[0].owner_id !== user.id) return fail(res, 403, "Cette sauvegarde appartient à un autre compte.");
    if (existing?.[0] && !existing[0].owner_id) return fail(res, 409, "Cette ancienne sauvegarde doit être vérifiée avant toute modification.");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
    await db("trimemo_project_state?on_conflict=project_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ project_id: id, owner_id: user.id, state, updated_at: now.toISOString(), expires_at: expiresAt }),
    });
    const updated = await db("trimemo_project_state?project_id=eq." + encodeURIComponent(id) + "&owner_id=eq." + encodeURIComponent(user.id), {
      method: "PATCH",
      body: JSON.stringify({ state, updated_at: now.toISOString(), expires_at: expiresAt }),
    });
    if (!Array.isArray(updated) || updated.length !== 1) return fail(res, 403, "La sauvegarde appartient à un autre compte ou doit être vérifiée.");
    return res.status(200).json({ success: true, savedAt: now.toISOString() });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("TRIMEMO_PROJECT_STATE_FAILED", { method: req.method, status, message: String(error?.message || "unknown").slice(0, 180) });
    return fail(res, status, status === 503 ? "Le stockage Supabase n'est pas configuré ou la migration de sécurité manque." : status >= 500 ? "Impossible d'accéder à la sauvegarde du projet." : String(error?.message || "Accès refusé."));
  }
}
