const OPENAI_URL = "https://api.openai.com/v1/responses";

const IMMUTABLE_KEYS = new Set([
  "id", "url", "doi", "author", "year", "isbn", "issn", "wordcount",
  "pagecount", "sources", "bibliography", "citations", "references",
  "footnotes", "citation", "reference", "createdat", "updatedat"
]);

function wordCount(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).length;
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\b(?:M|Mme|Mlle|Dr|Pr|etc|p\. ex|cf)\./giu, match => match.replace(".", "§"))
    .split(/(?<=[.!?])(?:["»”’)]*)\s+(?=[«“"'(\p{Lu}\d])/u)
    .map(s => s.replace(/§/g, ".").trim())
    .filter(Boolean);
}

export function inspectAcademicStyle(text) {
  const value = String(text || "");
  const issues = [];
  if (value.includes("—")) issues.push("présence du tiret long « — »");
  const longSentences = splitSentences(value)
    .map(sentence => ({ sentence, words: wordCount(sentence) }))
    .filter(item => item.words > 20);
  for (const item of longSentences.slice(0, 8)) {
    issues.push(`phrase de ${item.words} mots (maximum 20) : « ${item.sentence.slice(0, 180)} »`);
  }
  const normalizedSentences = splitSentences(value).map(s =>
    s.toLocaleLowerCase("fr").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim()
  );
  const seen = new Set();
  for (const sentence of normalizedSentences) {
    if (sentence.length > 35 && seen.has(sentence)) {
      issues.push("répétition exacte d'une phrase");
      break;
    }
    seen.add(sentence);
  }
  const connectorMatches = value.match(/\b(?:en effet|de plus|cependant)\b/giu) || [];
  if (connectorMatches.length >= 3) {
    issues.push("emploi répétitif de connecteurs mécaniques (« en effet », « de plus », « cependant »)");
  }
  return [...new Set(issues)];
}

function collectEditableStrings(value, path = [], output = []) {
  if (typeof value === "string") {
    if (path.length && !IMMUTABLE_KEYS.has(String(path[path.length - 1]).toLowerCase())) {
      const issues = inspectAcademicStyle(value);
      if (issues.length) output.push({ path, text: value, issues });
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEditableStrings(item, [...path, index], output));
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (IMMUTABLE_KEYS.has(key.toLowerCase())) continue;
      collectEditableStrings(child, [...path, key], output);
    }
  }
  return output;
}

function getAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}
function setAtPath(value, path, next) {
  let current = value;
  for (const key of path.slice(0, -1)) current = current[key];
  current[path[path.length - 1]] = next;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  return (data?.output || []).flatMap(item => item?.content || [])
    .filter(item => item?.type === "output_text" && typeof item.text === "string")
    .map(item => item.text).join("").trim();
}

async function reviseFields(apiKey, fields, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_STYLE_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        max_output_tokens: Math.min(12000, Math.max(2000, fields.reduce((n, field) => n + wordCount(field.text) * 2, 0) + 1200)),
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `Tu es le correcteur stylistique obligatoire de Trimémo. Révise uniquement les champs fournis.
Règles impératives : chaque phrase contient au maximum 20 mots, sauf exception strictement nécessaire à la précision; supprime le tiret long « — »; élimine les répétitions exactes et les connecteurs mécaniques répétés; évite les formulations vagues, les clichés et les adverbes en -ment inutiles.
Préserve strictement le sens scientifique, les nuances, les termes disciplinaires, les données, les citations intégrées et la position argumentative. N'ajoute aucun fait, résultat, auteur, chiffre ou source. Ne modifie pas le contenu factuel. N'introduis aucun tiret long.
Retourne chaque identifiant une seule fois avec son texte corrigé. Ne fusionne pas les champs et ne change pas leurs identifiants. La sortie doit être un JSON conforme au schéma.`
            }]
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: "CHAMPS À CORRIGER ET DÉFAUTS DÉTECTÉS :\n" + JSON.stringify(fields)
            }]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "trimemo_style_correction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: { id: { type: "string" }, text: { type: "string" } },
                    required: ["id", "text"]
                  }
                }
              },
              required: ["items"]
            }
          }
        }
      })
    });
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) {
    let message = raw;
    try { message = JSON.parse(raw)?.error?.message || message; } catch {}
    const error = new Error("Contrôle stylistique indisponible : " + String(message).slice(0, 500));
    error.status = 502;
    throw error;
  }
  let data;
  try { data = JSON.parse(raw); } catch {
    const error = new Error("Réponse invalide du contrôle stylistique.");
    error.status = 502;
    throw error;
  }
  const output = extractOutputText(data);
  try { return JSON.parse(output).items; } catch {
    const error = new Error("Le contrôle stylistique n'a pas retourné un JSON exploitable.");
    error.status = 502;
    throw error;
  }
}

/**
 * Corrects only objectively flagged prose fields. Structure and immutable metadata
 * are retained by applying revised strings to their original paths.
 */
export async function enforceAcademicStyle(value, { apiKey = process.env.OPENAI_API_KEY, timeoutMs = 30000 } = {}) {
  const cloned = JSON.parse(JSON.stringify(value));
  const flagged = collectEditableStrings(cloned);
  if (!flagged.length) {
    return { value: cloned, correctedFields: 0, checkedFields: 0, issues: [] };
  }
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY est absente : contrôle stylistique impossible.");
    error.status = 500;
    throw error;
  }
  const fields = flagged.map((item, index) => ({
    id: "field-" + index,
    text: item.text,
    issues: item.issues
  }));
  const revised = await reviseFields(apiKey, fields, timeoutMs);
  const byId = new Map((Array.isArray(revised) ? revised : []).map(item => [item.id, item.text]));
  if (byId.size !== fields.length || fields.some(field => typeof byId.get(field.id) !== "string")) {
    const error = new Error("Le contrôle stylistique n'a pas corrigé tous les champs requis.");
    error.status = 502;
    throw error;
  }
  flagged.forEach((item, index) => {
    const corrected = byId.get("field-" + index);
    const remaining = inspectAcademicStyle(corrected);
    if (remaining.length) {
      const error = new Error("Le contrôle stylistique n'a pas éliminé tous les défauts : " + remaining.slice(0, 3).join("; "));
      error.status = 422;
      throw error;
    }
    setAtPath(cloned, item.path, corrected);
  });
  return { value: cloned, correctedFields: flagged.length, checkedFields: flagged.length, issues: flagged.flatMap(item => item.issues) };
}
