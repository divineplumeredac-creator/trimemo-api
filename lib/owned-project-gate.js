import { requireClientProject } from './client-project-auth.js';

// The client account token is separate from the premium entitlement token.
// Project ownership is always resolved by the server, never from body.userId.
export async function requireOwnedProject(req, project) {
  const projectId = String(project?.projectId || project?.project_id || '').trim();
  if (!projectId) {
    const error = new Error('Identifiant de projet manquant.');
    error.status = 400;
    throw error;
  }
  const token = String(req?.headers?.['x-trimemo-client-token'] || '').trim();
  const auth = token ? `Bearer ${token}` : String(req?.headers?.authorization || req?.headers?.Authorization || '');
  const user = await requireClientProject({ headers: { authorization: auth } }, projectId);
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const query = new URLSearchParams({ select: 'owner_id', project_id: `eq.${projectId}`, limit: '1' });
  const response = await fetch(`${url}/rest/v1/trimemo_project_state?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Object.assign(new Error('La vérification du projet est indisponible.'), { status: 503 });
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1) throw Object.assign(new Error('Le document enregistré est introuvable.'), { status: 409 });
  if (rows[0].owner_id && rows[0].owner_id !== user.id) throw Object.assign(new Error('La propriété de ce projet doit être vérifiée. Contactez le support.'), { status: 409 });
  return user;
}
