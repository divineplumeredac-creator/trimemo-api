import { projectFingerprint } from "./premium-auth.js";

function config() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) { const e = new Error("Le registre sécurisé des commandes Supabase n'est pas configuré."); e.status = 503; throw e; }
  return { url, key };
}
async function request(path, init = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) }, signal: AbortSignal.timeout(5000) });
  const raw = await response.text();
  if (!response.ok) { const e = new Error("Le registre des commandes est indisponible."); e.status = 503; throw e; }
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function safeProjectSnapshot(project = {}) {
  const { documentContext, ...rest } = project;
  const files = (Array.isArray(project.files) ? project.files : []).map((file) => ({ name: String(file?.name || ""), type: String(file?.type || ""), category: String(file?.category || ""), content: "" }));
  return { ...rest, files };
}
export async function assertOrderLedgerReady() {
  await request("trimemo_orders?select=order_id&limit=1", { method: "GET" });
  return true;
}
export async function getOrderRecord(orderId) {
  const id = String(orderId || "").trim(); if (!id) return null;
  const rows = await request(`trimemo_orders?order_id=eq.${encodeURIComponent(id)}&select=order_id,project_id,project_fingerprint,project_snapshot,status,amount,currency,capture_id,created_at,paid_at,consumed_at&limit=1`, { method: "GET" });
  return rows?.[0] || null;
}
export async function recordPendingOrder({ orderId, project, amount, currency }) {
  const id = String(orderId || "").trim();
  const projectId = String(project?.projectId || project?.project_id || "").trim();
  if (!id || !projectId) { const e = new Error("Référence de commande ou projet absente."); e.status = 400; throw e; }
  const fingerprint = projectFingerprint(project);
  const existing = await getOrderRecord(id);
  if (existing) {
    if (existing.project_id !== projectId || existing.project_fingerprint !== fingerprint) { const e = new Error("Cette commande est déjà liée à un autre projet."); e.status = 403; throw e; }
    return existing;
  }
  const row = { order_id: id, project_id: projectId, project_fingerprint: fingerprint, project_snapshot: safeProjectSnapshot(project), status: "pending", amount: String(amount || ""), currency: String(currency || ""), capture_id: null, created_at: new Date().toISOString(), paid_at: null, consumed_at: null };
  await request("trimemo_orders?on_conflict=order_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row) });
  const confirmed = await getOrderRecord(id);
  if (!confirmed || confirmed.project_id !== projectId || confirmed.project_fingerprint !== fingerprint) { const e = new Error("La commande n'a pas pu être enregistrée de façon sûre."); e.status = 503; throw e; }
  return confirmed;
}
export async function recordPaidOrder({ orderId, project, amount, currency, captureId }) {
  const id = String(orderId || "").trim();
  if (!id) { const e = new Error("Référence de paiement absente."); e.status = 400; throw e; }
  const projectId = String(project?.projectId || project?.project_id || "").trim();
  if (!projectId) { const e = new Error("Identifiant du projet absent."); e.status = 400; throw e; }
  const fingerprint = projectFingerprint(project);
  const existing = await getOrderRecord(id);
  if (existing) {
    if (existing.project_id !== projectId || existing.project_fingerprint !== fingerprint) { const e = new Error("Cette commande est liée à un autre projet."); e.status = 403; throw e; }
    if (existing.status === "consumed" || existing.consumed_at) { const e = new Error("Le crédit de cette commande a déjà été consommé."); e.status = 403; throw e; }
    if (existing.status === "paid") return existing;
    if (existing.status !== "pending") { const e = new Error("Le statut de la commande n'est pas valide."); e.status = 403; throw e; }
    const { url, key } = config();
    const response = await fetch(`${url}/rest/v1/trimemo_orders?order_id=eq.${encodeURIComponent(id)}&status=eq.pending`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "paid", amount: String(amount || existing.amount || ""), currency: String(currency || existing.currency || ""), capture_id: String(captureId || ""), paid_at: new Date().toISOString() }), signal: AbortSignal.timeout(5000) });
    const updated = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(updated) || updated.length !== 1) { const e = new Error("Le paiement n'a pas pu être confirmé dans le registre sécurisé."); e.status = 503; throw e; }
    return updated[0];
  }
  const row = { order_id: id, project_id: projectId, project_fingerprint: fingerprint, project_snapshot: safeProjectSnapshot(project), status: "paid", amount: String(amount || ""), currency: String(currency || ""), capture_id: String(captureId || ""), created_at: new Date().toISOString(), paid_at: new Date().toISOString(), consumed_at: null };
  await request("trimemo_orders?on_conflict=order_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row) });
  const confirmed = await getOrderRecord(id);
  if (!confirmed || confirmed.project_id !== projectId || confirmed.project_fingerprint !== fingerprint || confirmed.status !== "paid" || confirmed.consumed_at) { const e = new Error("Le paiement n'a pas pu être enregistré de façon sûre."); e.status = 503; throw e; }
  return confirmed;
}
export async function assertOrderUsable(tokenData, project) {
  const id = String(tokenData?.payment || "").trim();
  if (!id) { const e = new Error("Le jeton ne contient aucune commande payée."); e.status = 402; throw e; }
  const row = await getOrderRecord(id);
  if (!row || !["paid", "consumed"].includes(row.status)) { const e = new Error("Le paiement n'est pas disponible."); e.status = 403; throw e; }
  const projectId = String(project?.projectId || project?.project_id || "").trim();
  if (row.project_id !== projectId || row.project_fingerprint !== projectFingerprint(project)) { const e = new Error("Le paiement ne correspond pas à ce projet."); e.status = 403; throw e; }
  // Autoriser une nouvelle tentative d'export pour le même projet payé si
  // le fichier a été créé mais que le navigateur n'a pas reçu le téléchargement.
  return row;
}
export async function consumeOrderAfterExport(tokenData, project) {
  const row = await assertOrderUsable(tokenData, project);
  if (row.status === "consumed" || row.consumed_at) return true;
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/trimemo_orders?order_id=eq.${encodeURIComponent(row.order_id)}&status=eq.paid&consumed_at=is.null`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "consumed", consumed_at: new Date().toISOString() }), signal: AbortSignal.timeout(5000) });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows) || rows.length !== 1) { const e = new Error("Impossible de clôturer le crédit de façon sûre. Relancez l'export."); e.status = 503; throw e; }
  return true;
}
