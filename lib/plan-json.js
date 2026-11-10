export function parsePlanJson(value) {
  const input = String(value || "");
  try { return JSON.parse(input); } catch {}
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(input.slice(start, end + 1)); } catch {}
  }
  const error = new Error("Le moteur a renvoyé un plan dans un format invalide.");
  error.status = 502;
  error.code = "PLAN_JSON_INVALID";
  throw error;
}

// Retry only malformed JSON. Never retry authentication, provider, rate-limit,
// or timeout errors, and never accept or silently alter an invalid plan.
export async function retryMalformedPlan(generate) {
  try { return await generate(false); }
  catch (error) {
    if (error?.code !== "PLAN_JSON_INVALID") throw error;
    return generate(true);
  }
}
