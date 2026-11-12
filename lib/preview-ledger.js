import crypto from 'node:crypto';
import { supabaseAdminRequest } from './admin-data.js';

const table = '/rest/v1/trimemo_preview_ledger';
const unavailable = () => Object.assign(new Error('Le suivi sécurisé de l’aperçu est momentanément indisponible. Réessayez.'), { status: 503 });
const countWords = value => String(value || '').trim().split(/\s+/u).filter(Boolean).length;
const keyOf = (blockId, planId, problematicId) => crypto.createHash('sha256').update(JSON.stringify([blockId, planId, problematicId])).digest('hex');

async function getLedger(projectId, ownerId) {
  const q = new URLSearchParams({ project_id:`eq.${projectId}`, owner_id:`eq.${ownerId}`, select:'*', limit:'1' });
  const { data } = await supabaseAdminRequest(`${table}?${q}`);
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}
async function changeLedger(row, update) {
  const q = new URLSearchParams({ project_id:`eq.${row.project_id}`, owner_id:`eq.${row.owner_id}`, revision:`eq.${row.revision}` });
  const { data } = await supabaseAdminRequest(`${table}?${q}`, { method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify({...update, revision:row.revision + 1}) });
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}
async function legacyWords(projectId, ownerId) {
  // L'appartenance a déjà été contrôlée ; les anciens états peuvent avoir owner_id nul.
  const q = new URLSearchParams({ project_id:`eq.${projectId}`, select:'state', limit:'1' });
  const { data } = await supabaseAdminRequest(`/rest/v1/trimemo_project_state?${q}`);
  const state = data?.[0]?.state || {};
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  const blocksWords = blocks.filter(b => b?.status === 'done').reduce((n,b) => n + countWords(b.content),0);
  const previewWords = countWords(state.preview?.introduction?.content) + countWords(state.preview?.chapterOne?.content);
  return Math.max(blocksWords, previewWords);
}
export async function reservePreview({projectId, ownerId, blockId, planId, problematicId, limit}) {
  if (!projectId || !ownerId || !blockId || !planId || !problematicId || !Number.isSafeInteger(limit) || limit < 1 || blockId.length > 300 || planId.length > 300 || problematicId.length > 300) throw Object.assign(new Error('Le bloc ou le plan de l’aperçu est invalide.'), {status:400});
  let row = await getLedger(projectId, ownerId);
  if (!row) {
    const baseline = Math.min(limit, await legacyWords(projectId, ownerId));
    await supabaseAdminRequest(`${table}?on_conflict=project_id`, {method:'POST', headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}, body:JSON.stringify({project_id:projectId,owner_id:ownerId,limit_words:limit,used_words:baseline})});
    row = await getLedger(projectId, ownerId);
    if (!row) throw unavailable();
  }
  const key = keyOf(blockId,planId,problematicId);
  for (let attempt=0; attempt<4; attempt++) {
    const receipt = row.receipts?.[key];
    if (receipt?.response) return {cached:receipt.response};
    if (row.active_token && Date.parse(row.active_until) > Date.now()) throw Object.assign(new Error('Une rédaction est déjà en cours pour ce projet. Réessayez dans quelques instants.'), {status:409});
    const effectiveLimit = Math.min(limit, Number(row.limit_words));
    const remaining = effectiveLimit - Number(row.used_words);
    if (remaining <= 0) throw Object.assign(new Error('La limite de l’aperçu est atteinte. Consultez l’aperçu pour poursuivre.'), {status:402});
    const token = crypto.randomUUID();
    const claimed = await changeLedger(row, {limit_words:effectiveLimit, active_token:token, active_until:new Date(Date.now()+10*60*1000).toISOString()});
    if (claimed) return {row:claimed, token, key, remaining};
    row = await getLedger(projectId, ownerId);
    if (!row) throw unavailable();
  }
  throw unavailable();
}
export async function completePreview(reservation, {response, remainder, visible, blockId, planId, problematicId, privateFootnotes}) {
  const {row, token, key, remaining} = reservation;
  const used = countWords(visible);
  if (used > remaining || row.active_token !== token) throw unavailable();
  const continuationId = remainder ? crypto.randomUUID() : undefined;
  const publicResponse = {...response, ...(continuationId ? {continuationId, previewLimitReached:true} : {})};
  const receipt = {response:publicResponse, remainder:remainder || '', visible, continuationId, blockId, planId, problematicId, privateFootnotes:privateFootnotes || []};
  const nextUsed = remainder ? Number(row.limit_words) : Number(row.used_words) + used;
  const saved = await changeLedger(row, {used_words:nextUsed, active_token:null, active_until:null, receipts:{...(row.receipts || {}),[key]:receipt}});
  if (!saved) throw unavailable();
  reservation.completed = true;
  return publicResponse;
}
export async function releasePreview(reservation) {
  if (!reservation?.row || reservation.completed) return;
  try {
    const row = await getLedger(reservation.row.project_id,reservation.row.owner_id);
    if (row?.active_token === reservation.token) await changeLedger(row,{active_token:null,active_until:null});
  } catch { /* la réservation expire automatiquement */ }
}
export async function findContinuation(id, projectId, ownerId) {
  const row = await getLedger(projectId,ownerId);
  const receipt = Object.values(row?.receipts || {}).find(item => item?.continuationId === id);
  if (!receipt) return null;
  return {project_id:projectId,owner_id:ownerId,block_id:receipt.blockId,plan_id:receipt.planId,problematic_id:receipt.problematicId,visible_content:receipt.visible,remainder:receipt.remainder,footnotes:receipt.privateFootnotes};
}
