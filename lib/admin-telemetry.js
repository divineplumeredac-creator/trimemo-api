import { supabaseAdminRequest, readAdminSettings } from "./admin-data.js";

function safeText(value, limit = 300) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, limit);
}

export async function logAdminEvent(event = {}) {
  try {
    const row = {
      actor: safeText(event.actor || "system", 254),
      category: safeText(event.category || "application", 80),
      severity: ["debug", "info", "warning", "error", "critical"].includes(event.severity) ? event.severity : "info",
      action: safeText(event.action || "event", 100),
      message: safeText(event.message || "Événement applicatif", 500),
      request_path: safeText(event.requestPath || "", 180) || null,
      status_code: Number.isFinite(Number(event.statusCode)) ? Number(event.statusCode) : null,
      request_id: safeText(event.requestId || "", 150) || null,
      metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
    };
    await supabaseAdminRequest("/rest/v1/trimemo_admin_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch {
    // Le suivi ne doit jamais faire échouer une requête métier.
  }
}

export async function recordOpenAIUsage({ endpoint, model, usage, status = "success", durationMs, requestId, errorCode, projectId, itemCount } = {}) {
  try {
    const settings = await readAdminSettings();
    const inputTokens = Math.max(0, Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) || 0);
    const outputTokens = Math.max(0, Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) || 0);
    const totalTokens = Math.max(0, Number(usage?.total_tokens ?? (inputTokens + outputTokens)) || 0);
    const inputRate = Number(settings.usage_costs?.inputUsdPerMillion);
    const outputRate = Number(settings.usage_costs?.outputUsdPerMillion);
    const hasRates = Number.isFinite(inputRate) && inputRate >= 0 && Number.isFinite(outputRate) && outputRate >= 0;
    const cost = hasRates ? (inputTokens * inputRate + outputTokens * outputRate) / 1000000 : null;
    const row = {
      endpoint: safeText(endpoint || "unknown", 100),
      model: safeText(model || "unknown", 100),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: cost === null ? null : Number(cost.toFixed(6)),
      status: ["success", "error", "incomplete"].includes(status) ? status : "success",
      duration_ms: Math.max(0, Math.round(Number(durationMs) || 0)),
      request_id: safeText(requestId || "", 150) || null,
      error_code: safeText(errorCode || "", 120) || null,
      metadata: {
        ...(projectId ? { projectId: safeText(projectId, 120) } : {}),
        ...(Number.isFinite(Number(itemCount)) ? { itemCount: Math.max(0, Math.round(Number(itemCount))) } : {}),
      },
    };
    await supabaseAdminRequest("/rest/v1/trimemo_openai_usage", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch {
    // Les journaux sont facultatifs pour le succès de la génération.
  }
}
