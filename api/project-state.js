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
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const raw = await response.text();
  if (!response.ok) {
    const diagnostic = raw.replace(/(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,})/g, "[token]").slice(0, 220);
    const error = new Error("Supabase REST HTTP " + response.status + ": " + diagnostic);
    error.status = response.status === 404 ? 503 : 502;
    throw error;
  }
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function projectId(req) {
  const value = String(req.method === "GET" ? req.query?.projectId : req.body?.projectId || "").trim();
  // Project IDs are UUID capability identifiers; do not accept arbitrary table filters.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return "";
  return value;
}
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return fail(res, 405, "Utilisez GET ou POST.");
  const id = projectId(req);
  if (!id) return fail(res, 400, "Identifiant de projet invalide.");
  try {
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
    const serialized = JSON.stringify(state);
    if (serialized.length > 2_000_000) return fail(res, 413, "Le projet est trop volumineux pour être sauvegardé en une seule fois.");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
    await db("trimemo_project_state?on_conflict=project_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ project_id: id, state, updated_at: now.toISOString(), expires_at: expiresAt }),
    });
    return res.status(200).json({ success: true, savedAt: now.toISOString() });
  } catch (error) {
    console.error("TRIMEMO_PROJECT_STATE_FAILED", { method: req.method, status: Number(error?.status) || 500, message: String(error?.message || "unknown").slice(0, 260) });
    return fail(res, Number(error?.status) || 500, Number(error?.status) === 503 ? "Le stockage Supabase n'est pas configuré ou la table est absente." : "Impossible de sauvegarder le projet sur le serveur.");
  }
}
