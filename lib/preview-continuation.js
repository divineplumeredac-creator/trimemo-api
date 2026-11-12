import crypto from 'node:crypto';
import { supabaseAdminRequest } from './admin-data.js';

// Preserve every character: the displayed prefix and the private suffix must
// reconstruct the original output byte-for-byte when payment is confirmed.
export function splitPreviewText(value, limit) {
  const source = String(value || '');
  const count = Number(limit);
  if (!Number.isSafeInteger(count) || count <= 0) return { visible: '', remainder: source };
  const words = [...source.matchAll(/\S+/gu)];
  if (words.length <= count) return { visible: source, remainder: '' };
  const last = words[count - 1];
  const candidate = source.slice(0, last.index + last[0].length);
  const boundaries = [...candidate.matchAll(/[.!?…](?:[»”"')\]]*)?(?=\s|$)/gu)];
  if (!boundaries.length) return { visible: '', remainder: source };
  const boundary = boundaries[boundaries.length - 1];
  const end = boundary.index + boundary[0].length;
  return { visible: source.slice(0, end), remainder: source.slice(end) };
}

export async function savePreviewContinuation({ projectId, ownerId, blockId, planId, problematicId, visible, remainder }) {
  if (!projectId || !ownerId || !blockId || !planId || !problematicId || typeof visible !== 'string' || !remainder) {
    throw Object.assign(new Error('La suite du document ne peut pas être sauvegardée.'), { status: 503 });
  }
  const id = crypto.randomUUID();
  const result = await supabaseAdminRequest('/rest/v1/trimemo_preview_continuations', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id, project_id: projectId, owner_id: ownerId, block_id: blockId, plan_id: planId, problematic_id: problematicId, visible_content: visible, remainder }),
  });
  if (!Array.isArray(result.data) || result.data.length !== 1 || result.data[0].id !== id) {
    throw Object.assign(new Error('La sauvegarde de la suite du document n’a pas pu être confirmée.'), { status: 503 });
  }
  return id;
}

export async function loadPreviewContinuation(id, projectId, ownerId) {
  const params = new URLSearchParams({ select: 'id,project_id,owner_id,block_id,plan_id,problematic_id,visible_content,remainder', id: `eq.${id}`, project_id: `eq.${projectId}`, owner_id: `eq.${ownerId}`, limit: '1' });
  const { data } = await supabaseAdminRequest(`/rest/v1/trimemo_preview_continuations?${params}`);
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}
