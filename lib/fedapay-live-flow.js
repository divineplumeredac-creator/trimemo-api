import { createLiveTransaction, livePaymentLink, liveTransaction, validateLivePayment } from './fedapay-live.js';

const fail = (message, status=400) => Object.assign(new Error(message), { status });

// This orchestration requires a repository with atomic per-project reservation.
// It is deliberately not wired to production routes or a production database.
export function createLivePaymentFlow({ repository, provider = { createLiveTransaction, livePaymentLink, liveTransaction }, key, callbackUrl }) {
  if (!repository || !key) throw fail('Le paiement de test est indisponible.', 503);

  async function begin({ userId, projectId, reference, project, quote, customer }) {
    if (!userId || !projectId || String(project?.projectId || project?.project_id || '') !== String(projectId)) throw fail('Projet ou compte invalide.', 403);
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(reference || ''))) throw fail('Référence invalide.');
    if (!quote || quote.currency !== 'XOF' || !Number.isSafeInteger(quote.estimatedAmount) || quote.estimatedAmount <= 0) throw fail('Le montant en francs CFA doit être vérifié par le serveur.');
    // reserve() must commit before the provider request. It must enforce one
    // unresolved payment across providers with a database uniqueness constraint.
    const intent = await repository.reserve({ userId, projectId, reference, project, amount: quote.estimatedAmount, currency: 'XOF', provider: 'fedapay' });
    if (!intent || intent.reference !== reference) throw fail('Une autre tentative de paiement existe déjà pour ce projet.', 409);
    // Any error after reserve is treated as ambiguous. Never release the lock
    // or automatically create another transaction on timeout.
    const tx = await provider.createLiveTransaction({ key, amount: intent.amount, reference: intent.reference, callbackUrl, customer });
    await repository.attachProviderId({ reference, providerId: tx.id });
    const url = await provider.livePaymentLink({ key, transactionId: tx.id });
    await repository.markReady({ reference, providerId: tx.id });
    return { id: tx.id, url };
  }

  async function verify({ userId, providerId }) {
    const intent = await repository.findByProviderId(String(providerId || ''));
    if (!intent || intent.userId !== userId || intent.provider !== 'fedapay') throw fail('Cette commande est indisponible.', 403);
    const tx = await provider.liveTransaction({ key, transactionId: String(providerId) });
    const approved = validateLivePayment(tx, { id: intent.providerId, amount: intent.amount, reference: intent.reference, currency: intent.currency });
    if (!approved) return { status: 'PENDING' };
    // Must atomically record payment and grant the original project only once.
    return repository.confirmApproved({ reference: intent.reference, providerId: intent.providerId, userId: intent.userId, projectId: intent.projectId, amount: intent.amount, currency: intent.currency });
  }
  return { begin, verify };
}
