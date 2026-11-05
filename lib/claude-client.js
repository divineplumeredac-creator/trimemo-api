// Client Claude (API Messages d'Anthropic) pour Trimémo.
// Deux points d'entrée :
// - callClaude : appel direct (utilisé par generate-block.js).
// - claudeFetch : remplace fetch() pour les appels écrits au format « Responses » ;
//   il traduit la requête, appelle Claude et renvoie une Response compatible
//   (output_text, status, usage, id), afin que la logique existante ne change pas.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function getClaudeModel() {
  return String(process.env.CLAUDE_MODEL || "claude-sonnet-5-5").trim();
}

function extractJsonObject(text) {
  const cleaned = String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

function parseImage(url) {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/s.exec(String(url || ""));
  if (!match || !SUPPORTED_IMAGE_TYPES.includes(match[1].toLowerCase())) return null;
  return { type: "base64", media_type: match[1].toLowerCase(), data: match[2] };
}

// Traduit un corps « Responses » (OpenAI) en corps « Messages » (Anthropic).
function toAnthropicBody(payload = {}, { webSearch } = {}) {
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
        content.push({ type: "text", text: String(part.text) });
      } else if (part?.type === "input_image") {
        const source = parseImage(part.image_url);
        if (source) content.push({ type: "image", source });
      }
    }
    if (content.length) messages.push({ role: role === "assistant" ? "assistant" : "user", content });
  }

  const format = payload.text?.format;
  if (format?.type === "json_schema" && format.schema) {
    systemParts.push(
      "FORMAT DE SORTIE OBLIGATOIRE : réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, " +
      "sans balise markdown, conforme à ce schéma JSON :\n" + JSON.stringify(format.schema)
    );
  }

  const body = {
    model: getClaudeModel(),
    max_tokens: Math.min(64000, Math.max(1, Number(payload.max_output_tokens) || 8000)),
    messages: messages.length ? messages : [{ role: "user", content: [{ type: "text", text: "Réponds." }] }],
  };
  if (systemParts.length) body.system = systemParts.join("\n\n");

  const wantsSearch = webSearch ?? (Array.isArray(payload.tools) && payload.tools.some((t) => /^web_search/.test(String(t?.type || ""))));
  if (wantsSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

  return body;
}

// Envoie un corps Messages à Anthropic et renvoie une Response au format attendu par le code existant.
async function sendAnthropic({ apiKey, body, signal }) {
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
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
  const inputTokens = Number(data.usage?.input_tokens || 0);
  const outputTokens = Number(data.usage?.output_tokens || 0);

  const adapted = {
    id: data.id,
    status: incomplete ? "incomplete" : "completed",
    incomplete_details: incomplete ? { reason: "max_output_tokens" } : null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    output_text: incomplete ? text : extractJsonObject(text),
  };

  return new Response(JSON.stringify(adapted), { status: 200, headers: jsonHeaders });
}

// Appel direct (rédaction des blocs).
export async function callClaude({ apiKey, system, user, maxTokens = 12000, webSearch = false, maxSearches = 5 }) {
  const body = {
    model: getClaudeModel(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
  return sendAnthropic({ apiKey, body });
}

// Remplaçant de fetch() pour les appels à l'URL « Responses » d'OpenAI.
export async function claudeFetch(url, init = {}) {
  if (url !== OPENAI_RESPONSES_URL) return fetch(url, init);
  const headers = init.headers || {};
  const auth = String(headers.Authorization || headers.authorization || "");
  const apiKey = auth.replace(/^Bearer\s+/i, "").trim() || process.env.TRIMEMO_CLAUDE_API_KEY;
  const payload = JSON.parse(String(init.body || "{}"));
  return sendAnthropic({ apiKey, body: toAnthropicBody(payload), signal: init.signal });
}
