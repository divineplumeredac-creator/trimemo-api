// Client Claude (API Messages d'Anthropic) pour Trimémo.
// - getClaudeModel("writing") : Sonnet, pour la rédaction (blocs, aperçu gratuit).
// - getClaudeModel("light")   : Haiku, pour les tâches légères (plans, problématiques, estimation, contrôle de style).
// - callClaude : appel direct (utilisé par generate-block.js).
// - claudeFetch : remplace fetch() pour les appels écrits au format « Responses » d'OpenAI.
// Le prompt système est mis en cache (cache_control) et le nombre de recherches web est limité.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function getClaudeModel(task = "writing") {
  if (task === "light") {
    return String(process.env.CLAUDE_LIGHT_MODEL || "claude-haiku-5-5").trim();
  }
  return String(process.env.CLAUDE_WRITING_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-5-5").trim();
}

// Nombre maximal de recherches web par appel (défaut : 2). Mettre 0 pour désactiver.
function getMaxSearches() {
  const n = Number(process.env.CLAUDE_MAX_SEARCHES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

function webSearchTools() {
  const max = getMaxSearches();
  if (max === 0) return undefined;
  return [{ type: "web_search_20250305", name: "web_search", max_uses: max }];
}

// Le prompt système est marqué pour le cache : les appels suivants le relisent à coût réduit.
function systemBlocks(text, ttl = '5m') {
  if (!text) return undefined;
  return [{ type: "text", text: String(text), cache_control: { type: "ephemeral", ttl: ttl === '1h' ? '1h' : '5m' } }];
}

function extractJsonObject(text) {
  const cleaned = String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return cleaned;

  // Keep the first complete top-level object. A greedy first-to-last-brace
  // slice also captures trailing commentary/JSON and makes valid plans fail.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned.slice(start);
}

function parseImage(url) {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/s.exec(String(url || ""));
  if (!match || !SUPPORTED_IMAGE_TYPES.includes(match[1].toLowerCase())) return null;
  return { type: "base64", media_type: match[1].toLowerCase(), data: match[2] };
}

// Traduit un corps « Responses » (OpenAI) en corps « Messages » (Anthropic).
function toAnthropicBody(payload = {}) {
  const systemParts = [];
  const messages = [];

  for (const item of Array.isArray(payload.input) ? payload.input : []) {
    const role = item?.role;
    const parts = Array.isArray(item?.content)
      ? item.content
      : [{ type: "input_text", text: String(item?.content || "") }];

    if (role === "system" || role === "developer") {
      for (const part of parts) if (part?.type === "input_text" && part.text) systemParts.push(String(part.text));
      continue;
    }

    const content = [];
    for (const part of parts) {
      if (part?.type === "input_text" && part.text) {
        content.push({ type: "text", text: String(part.text), ...(part.cache_control?.type === "ephemeral" ? { cache_control: { type: "ephemeral", ttl: part.cache_control.ttl === "1h" ? "1h" : "5m" } } : {}) });
      } else if (part?.type === "input_image") {
        const source = parseImage(part.image_url);
        if (source) content.push({ type: "image", source });
      }
    }
    if (content.length) messages.push({ role: role === "assistant" ? "assistant" : "user", content });
  }

  const format = payload.text?.format;
  if (format?.type === "json_schema" && format.schema && !payload.native_json_schema) {
    systemParts.push(
      "FORMAT DE SORTIE OBLIGATOIRE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, " +
      "sans balise markdown, conforme à ce schéma JSON :\n" + JSON.stringify(format.schema)
    );
  }

  const requestedModel = String(payload.model || "");
  const body = {
    model: requestedModel.startsWith("claude") ? requestedModel : getClaudeModel(),
    max_tokens: Math.min(64000, Math.max(1, Number(payload.max_output_tokens) || 8000)),
    messages: messages.length ? messages : [{ role: "user", content: [{ type: "text", text: "Réponds." }] }],
  };
  const system = systemBlocks(systemParts.join("\n\n"), payload.cache_ttl);
  if (payload.thinking?.type === "disabled") body.thinking = { type: "disabled" };
  if (payload.native_json_schema && format?.type === "json_schema" && format.schema) {
    body.output_config = { format: { type: "json_schema", schema: format.schema } };
  }
  if (system) body.system = system;

  const wantsSearch = Array.isArray(payload.tools) && payload.tools.some((t) => /^web_search/.test(String(t?.type || "")));
  if (wantsSearch) {
    const tools = webSearchTools();
    if (tools) body.tools = tools;
  }

  return body;
}

// Envoie un corps Messages à Anthropic et renvoie une Response au format attendu par le code existant.
async function sendAnthropic({ apiKey, body, signal }) {
  const credential = String(apiKey || '').trim();
  if (!credential || credential.length > 300 || /\s|[\r\n]/u.test(credential) || /(?:curl|--header|x-api-key:|api\.anthropic\.com)/iu.test(credential)) {
    const error = new Error('La configuration du fournisseur IA est invalide.');
    error.status = 503;
    error.code = 'PROVIDER_CREDENTIAL_INVALID';
    throw error;
  }
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": credential,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  });

  const raw = await upstream.text();
  const jsonHeaders = { "content-type": "application/json" };

  if (!upstream.ok) {
    let message = raw.slice(0, 2000);
    try {
      message = JSON.parse(raw)?.error?.message || message;
    } catch {}
    // Solde insuffisant : 429 pour que le message « crédits épuisés » s'affiche côté client.
    const status = /credit balance|billing|quota/i.test(message) ? 429 : upstream.status;
    return new Response(JSON.stringify({ error: { message } }), { status, headers: jsonHeaders });
  }

  const data = JSON.parse(raw);
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .join("")
    .trim();

  const incomplete = data.stop_reason === "max_tokens";
  // Les tokens lus ou écrits dans le cache sont comptés à part par Anthropic : on les additionne pour le suivi.
  const inputTokens =
    Number(data.usage?.input_tokens || 0) +
    Number(data.usage?.cache_creation_input_tokens || 0) +
    Number(data.usage?.cache_read_input_tokens || 0);
  const outputTokens = Number(data.usage?.output_tokens || 0);

  const adapted = {
    id: data.id,
    model: data.model,
    status: incomplete ? "incomplete" : "completed",
    incomplete_details: incomplete ? { reason: "max_output_tokens" } : null,
    usage: {
      input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens,
      provider: "anthropic",
      uncached_input_tokens: Number(data.usage?.input_tokens || 0),
      cache_creation_input_tokens: Number(data.usage?.cache_creation_input_tokens || 0),
      cache_read_input_tokens: Number(data.usage?.cache_read_input_tokens || 0),
      cache_creation: data.usage?.cache_creation || {},
      server_tool_use: data.usage?.server_tool_use || {},
    },
    output_text: incomplete ? text : extractJsonObject(text),
  };

  return new Response(JSON.stringify(adapted), { status: 200, headers: jsonHeaders });
}

// Appel direct (rédaction des blocs).
export async function callClaude({ apiKey, system, user, maxTokens = 12000, webSearch = false, task = "writing", cacheTtl = "5m" }) {
  const body = {
    model: getClaudeModel(task),
    max_tokens: maxTokens,
    messages: [{ role: "user", content: user }],
  };
  const sys = systemBlocks(system, cacheTtl);
  if (sys) body.system = sys;
  if (webSearch) {
    const tools = webSearchTools();
    if (tools) body.tools = tools;
  }
  return sendAnthropic({ apiKey, body, signal: AbortSignal.timeout(240000) });
}

// Remplaçant de fetch() pour les appels à l'URL « Responses » d'OpenAI.
export async function claudeFetch(url, init = {}) {
  if (url !== OPENAI_RESPONSES_URL) return fetch(url, init);
  const headers = init.headers || {};
  const auth = String(headers.Authorization || headers.authorization || "");
  const apiKey = auth.replace(/^Bearer\s+/i, "").trim() || process.env.TRIMEMO_CLAUDE_API_KEY;
  const payload = JSON.parse(String(init.body || "{}"));
  return sendAnthropic({ apiKey, body: toAnthropicBody(payload), signal: init.signal || AbortSignal.timeout(240000) });
}
