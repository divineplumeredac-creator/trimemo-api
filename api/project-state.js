import { setCors } from "../lib/http.js";
import { requireOwner } from "../lib/owner-auth.js";

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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return "";
  return value;
}
function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || req.headers?.Authorization || ""));
  return match ? match[1].trim() : "";
}
async function clientUser(token) {
  if (!token) { const e = new Error("Connectez-vous à votre compte client pour synchroniser ce projet."); e.status = 401; throw e; }
  const { url, key } = config();
  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000),
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) { const e = new Error("Session client invalide ou expirée."); e.status = 401; throw e; }
  const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : 0;
  if (user.app_metadata?.trimemo_access === "suspended" || (Number.isFinite(bannedUntil) && bannedUntil > Date.now())) {
    const e = new Error("L'accès de ce compte a été suspendu."); e.status = 403; throw e;
  }
  return user;
}
async function authorizeProject(req, id, state = null) {
  const token = bearer(req);
  if (!token) { const e = new Error("Authentification requise pour accéder au projet distant."); e.status = 401; throw e; }
  try {
    const owner = requireOwner(req);
    return { role: "owner", owner };
  } catch {}
  const user = await clientUser(token);
  const memberships = await db("trimemo_client_projects?project_id=eq." + encodeURIComponent(id) + "&select=user_id,project_id&limit=2");
  const existing = Array.isArray(memberships) ? memberships : [];
  if (existing.some((row) => row.user_id !== user.id)) {
    const e = new Error("Ce projet est déjà rattaché à un autre compte client."); e.status = 403; throw e;
  }
  const ownMembership = existing.find((row) => row.user_id === user.id);
  if (!ownMembership && req.method === "GET") {
    const e = new Error("Ce projet n'est pas rattaché à votre compte client."); e.status = 403; throw e;
  }
  if (!ownMembership && req.method === "POST") {
    const subject = String(state?.project?.sujet || state?.project?.subject || "Projet académique").trim().slice(0, 240) || "Projet académique";
    await db("trimemo_client_projects?on_conflict=user_id,project_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: user.id, project_id: id, subject, payment_status: "draft", updated_at: new Date().toISOString() }),
    });
    const verify = await db("trimemo_client_projects?project_id=eq." + encodeURIComponent(id) + "&select=user_id&limit=2");
    if (!Array.isArray(verify) || !verify.some((row) => row.user_id === user.id) || verify.some((row) => row.user_id !== user.id)) {
      const e = new Error("Impossible de rattacher ce projet à votre compte de façon sûre."); e.status = 403; throw e;
    }
  }
  return { role: "client", user };
}
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return fail(res, 405, "Utilisez GET ou POST.");
  const id = projectId(req);
  if (!id) return fail(res, 400, "Identifiant de projet invalide.");
  try {
    if (req.method === "GET") {
      await authorizeProject(req, id);
      const rows = await db("trimemo_project_state?project_id=eq." + encodeURIComponent(id) + "&select=project_id,state,updated_at,expires_at&limit=1");
      const row = rows?.[0];
      if (!row) return res.status(200).json({ success: true, found: false });
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
        await db("trimemo_project_state?project_id=eq." + encodeURIComponent(id), { method: "DELETE" });
        return res.status(200).json({ success: true, found: false });
      }
      return res.status(200).json({ success: true, found: true, state: row.state, updatedAt: row.updated_at });
    }
    const state = req.body?.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) return fail(res, 400, "État du projet invalide.");
    const serialized = JSON.stringify(state);
    if (serialized.length > 2_000_000) return fail(res, 413, "Le projet est trop volumineux pour être sauvegardé en une seule fois.");
    await authorizeProject(req, id, state);
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
    console.error("TRIMEMO_PROJECT_STATE_FAILED", { method: req.method, status });
    return fail(res, status, status === 503 ? "Le stockage Supabase ou le service d'authentification est indisponible." : String(error?.message || "Impossible d'accéder au projet distant."));
  }
}
