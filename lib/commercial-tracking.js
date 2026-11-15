// Début du suivi commercial : 16 novembre 2026 00:00, heure du Bénin (UTC+1).
// L'historique pré-lancement reste conservé pour audit, tests et obligations financières.
export const COMMERCIAL_LAUNCH_AT = "2026-11-15T23:00:00.000Z";
const launchMs = Date.parse(COMMERCIAL_LAUNCH_AT);
export function inCommercialPeriod(value) {
  if (!value) return false;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) && ms >= launchMs;
}
export function isExplicitSandboxOrder(order) {
  const id = String(order?.order_id || "").trim().toLowerCase();
  return id.startsWith("fedapay-sandbox:") || id.startsWith("fedapay-test:") || id.startsWith("sandbox:");
}
export function isCommercialOrder(order) {
  if (!order || isExplicitSandboxOrder(order)) return false;
  const state = String(order.status || "").toLowerCase();
  if (["paid","consumed","refunded"].includes(state)) return inCommercialPeriod(order.paid_at);
  return state === "pending" && inCommercialPeriod(order.created_at);
}
export function isCommercialProject(project) {
  return inCommercialPeriod(project?.created_at) || inCommercialPeriod(project?.updated_at);
}
export function filterCommercialRows(rows, includeHistory, field="created_at") {
  return includeHistory ? rows : rows.filter(row => inCommercialPeriod(row?.[field]));
}
