function config() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) { const e = new Error("Le stockage sécurisé des documents de projet n'est pas configuré."); e.status = 503; throw e; }
  return { url, key };
}
async function request(path, init = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });
  const raw = await response.text();
  if (!response.ok) { const e = new Error("Le stockage sécurisé des documents est indisponible."); e.status = 503; throw e; }
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function projectIdOf(project) { return String(project?.projectId || project?.project_id || "").trim(); }
function metadata(files) { return (Array.isArray(files) ? files : []).map((file) => ({ name: String(file?.name || ""), type: String(file?.type || ""), category: String(file?.category || "") })); }
export async function storeProjectBundle(projectId, files, documentContext = {}) {
  const id = String(projectId || "").trim();
  if (!id) { const e = new Error("Identifiant de projet manquant pour stocker les documents."); e.status = 400; throw e; }
  const cleanFiles = (Array.isArray(files) ? files : []).filter((file) => file && typeof file.content === "string" && file.content.length);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await request("trimemo_project_files?on_conflict=project_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ project_id: id, files: cleanFiles, file_metadata: metadata(cleanFiles), document_context: documentContext || {}, updated_at: new Date().toISOString(), expires_at: expiresAt }) });
  return true;
}
export async function loadProjectBundle(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return null;
  const rows = await request(`trimemo_project_files?project_id=eq.${encodeURIComponent(id)}&select=project_id,files,file_metadata,document_context,expires_at&limit=1`, { method: "GET" });
  const row = rows?.[0];
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    await request(`trimemo_project_files?project_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return null;
  }
  return row;
}
export async function hydrateProjectFiles(project = {}) {
  const files = Array.isArray(project.files) ? project.files : [];
  if (!files.length || files.every((file) => typeof file?.content === "string" && file.content.length > 0)) return project;
  const id = projectIdOf(project);
  const row = await loadProjectBundle(id);
  if (!row || !Array.isArray(row.files)) { const e = new Error("Les documents de ce projet ne sont plus disponibles. Joignez-les à nouveau puis relancez l'analyse."); e.status = 409; throw e; }
  const savedFiles = row.files;
  const keyOf = (file) => [String(file?.name || ""), String(file?.type || "")].join("|");
  const savedByKey = new Map(savedFiles.map((file) => [keyOf(file), file]));
  const hydrated = files.map((file) => {
    if (typeof file?.content === "string" && file.content.length > 0) return file;
    const saved = savedByKey.get(keyOf(file));
    if (!saved) { const e = new Error("Un document joint est absent du stockage sécurisé. Joignez-le à nouveau."); e.status = 409; throw e; }
    return { ...saved, category: String(file?.category || saved.category || "reference") };
  });
  const savedContext = row.document_context || {};
  const sameFiles = JSON.stringify(metadata(hydrated)) === JSON.stringify(Array.isArray(row.file_metadata) ? row.file_metadata : metadata(savedFiles));
  if (sameFiles) return { ...project, files: hydrated, documentContext: savedContext };
  // New attachments were added after a prior estimate: validate sizes before parsing; the estimate endpoint will save the refreshed bundle.
  const { assertFilesSize } = await import("./limits.js");
  assertFilesSize(hydrated);
  const { buildProjectDocumentContext } = await import("./project-documents.js");
  const documentContext = await buildProjectDocumentContext(hydrated);
  return { ...project, files: hydrated, documentContext };
}
export async function deleteProjectBundle(projectId) {
  const id = String(projectId || "").trim(); if (!id) return;
  await request(`trimemo_project_files?project_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}
