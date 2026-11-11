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
  return requireClientProject({ headers: { authorization: auth } }, projectId);
}
