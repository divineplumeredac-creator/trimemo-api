// PayPal amounts are handled as integer minor units to avoid floating-point rounding.
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);
export function parseRefundAmount(value, currency) {
  const unit = ZERO_DECIMAL.has(String(currency || '').toUpperCase()) ? 0 : 2;
  const input = String(value ?? '').trim().replace(',', '.');
  const pattern = unit === 0 ? /^\d{1,9}$/ : /^\d{1,9}(?:\.\d{1,2})?$/;
  if (!pattern.test(input)) throw new Error('Montant de remboursement invalide.');
  const [whole, fraction = ''] = input.split('.');
  const amount = Number(whole) * (unit ? 100 : 1) + (unit ? Number(fraction.padEnd(2, '0')) : 0);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Le montant doit être supérieur à zéro.');
  return amount;
}
export function formatRefundAmount(amount, currency) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Montant invalide.');
  if (ZERO_DECIMAL.has(String(currency || '').toUpperCase())) return String(amount);
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}
export function chooseRefundAmount({ mode, amount, currency, total, alreadyRefunded = '0' }) {
  const totalMinor = parseRefundAmount(total, currency);
  const refundedMinor = String(alreadyRefunded).match(/^0(?:[.,]0{1,2})?$/) ? 0 : parseRefundAmount(alreadyRefunded, currency);
  const remaining = totalMinor - refundedMinor;
  if (remaining <= 0) throw new Error('La commande a déjà été entièrement remboursée.');
  if (!['full', 'partial'].includes(mode)) throw new Error('Choisissez un remboursement total ou partiel.');
  const selected = mode === 'full' ? remaining : parseRefundAmount(amount, currency);
  if (selected > remaining) throw new Error('Le montant dépasse le solde remboursable.');
  if (mode === 'partial' && selected >= remaining) throw new Error('Choisissez le remboursement total pour rembourser le solde entier.');
  return { minorUnits: selected, amount: formatRefundAmount(selected, currency), currency: String(currency).toUpperCase() };
}
