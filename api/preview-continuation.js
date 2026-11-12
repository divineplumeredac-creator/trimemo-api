import { setCors } from '../lib/http.js';
import { requireOwnedProject } from '../lib/owned-project-gate.js';
import { requirePremium } from '../lib/premium-auth.js';
import { assertClientProjectActive } from '../lib/admin-data.js';
import { assertOrderUsable } from '../lib/order-ledger.js';
import { loadPreviewContinuation } from '../lib/preview-continuation.js';

export default async function handler(req, res) {
  setCors(res, req, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  try {
    const project = req.body?.project || {};
    const id = String(req.body?.continuationId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ error: 'Référence de document invalide.' });
    const owner = await requireOwnedProject(req, project);
    const premium = requirePremium(req, project);
    await assertClientProjectActive(project.projectId || project.project_id);
    const order = await assertOrderUsable(premium, project);
    const record = await loadPreviewContinuation(id, project.projectId || project.project_id, owner.id);
    if (!record) return res.status(404).json({ error: 'Suite du document introuvable. Contactez le support.' });
    const snapshot = order.project_snapshot || {};
    if (record.plan_id !== snapshot.paymentPlanId || record.problematic_id !== snapshot.paymentProblematicId || record.block_id !== String(req.body?.blockId || '')) {
      return res.status(403).json({ error: 'La suite ne correspond pas au projet payé.' });
    }
    return res.status(200).json({ visible: record.visible_content, remainder: record.remainder });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status >= 400 && status < 500 ? status : 503).json({ error: status >= 400 && status < 500 ? error.message : 'La suite du document est momentanément indisponible. Réessayez sans régénérer le bloc.' });
  }
}
