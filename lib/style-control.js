import { getOpenAIModel } from "./openai-model.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";

const IMMUTABLE_KEYS = new Set([
  "id", "url", "doi", "author", "year", "isbn", "issn", "wordcount",
  "pagecount", "sources", "bibliography", "citations", "references",
  "footnotes", "citation", "reference", "structure", "createdat", "updatedat"
]);

function wordCount(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).length;
}

function splitSentences(text) {
  // Markdown headings are structural labels, not part of the following sentence.
  // Separate paragraphs first so a heading cannot inflate the word count of prose.
  return String(text || "")
    .replace(/^\s{0,3}#{1,6}\s+.*$/gmu, "")
    .replace(/\b(?:M|Mme|Mlle|Dr|Pr|etc|p\. ex|cf)\./giu, match => match.replace(".", "§"))
    .split(/\n\s*\n+/u)
    .flatMap(paragraph => paragraph
      .replace(/\n+/gu, " ")
      .split(/(?<=[.!?])(?:["»”’)]*)\s+(?=[«“"'(\p{Lu}\d])/u))
    .map(s => s.replace(/§/g, ".").trim())
    .filter(Boolean);
}

export function inspectAcademicStyle(text) {
  const value = String(text || "");
  const issues = [];
  if (value.includes("—")) issues.push("présence du tiret long « — »");
  if (/\b(?:à développer|il faudra (?:analyser|examiner|aborder|présenter|développer)|il convient d'aborder|nous allons (?:voir|examiner|analyser)|nous verrons|nous examinerons|cette partie (?:va traiter|présente|aborde|analyse|examine|traite|vise à)|ce chapitre (?:va|devra|doit) (?:présenter|traiter|aborder)|ce chapitre (?:présente|aborde|analyse|examine|traite|vise à)|cette section (?:va|présente|aborde|analyse|examine|traite|vise à)|la section suivante|dans la partie suivante|dans le chapitre suivant|dans ce chapitre|dans cette section|l'objectif de cette (?:partie|section)|l'objectif de ce chapitre)\b/iu.test(value)) {
    issues.push("métadiscours éditorial ou instruction sur ce que le texte doit faire");
  }
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

function countEditableStrings(value) {
  if (typeof value === "string") return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countEditableStrings(item), 0);
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((sum, [key, child]) =>
      sum + (IMMUTABLE_KEYS.has(key.toLowerCase()) ? 0 : countEditableStrings(child)), 0);
  }
  return 0;
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

async function reviseFields(apiKey, fields, timeoutMs, retry = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: getOpenAIModel(),
        max_output_tokens: Math.min(12000, Math.max(2000, fields.reduce((n, field) => n + wordCount(field.text) * 2, 0) + 1200)),
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `Tu es le correcteur stylistique obligatoire de Trimémo. Révise uniquement les champs fournis.
Règles impératives : chaque phrase contient au maximum 20 mots, sauf exception strictement nécessaire à la précision; supprime le tiret long « — »; élimine les répétitions exactes, les connecteurs mécaniques répétés, les clichés et les formulations vagues. Supprime tout métadiscours éditorial, commentaire technique ou instruction sur ce qu’il faudrait rédiger. Le texte doit exposer directement le raisonnement scientifique, sans annoncer les développements futurs.
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
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed?.items)) return parsed.items;
    throw new Error("La propriété items est absente ou invalide.");
  } catch (parseError) {
    // Responses can occasionally be incomplete or omit structured output.
    // Retry once before failing the entire academic-writing request.
    if (retry < 1) {
      console.warn("[Trimémo] Style correction returned unusable JSON; retrying once.", {
        status: data?.status || "unknown",
        incompleteReason: data?.incomplete_details?.reason || null,
        outputLength: output.length,
        outputPrefix: output.slice(0, 160)
      });
      return reviseFields(apiKey, fields, timeoutMs, retry + 1);
    }
    const error = new Error(
      "Le contrôle stylistique n'a pas retourné un JSON exploitable après une seconde tentative." +
      (data?.incomplete_details?.reason ? " Réponse incomplète : " + data.incomplete_details.reason : "")
    );
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
    return { value: cloned, correctedFields: 0, checkedFields: countEditableStrings(cloned), issues: [] };
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
  const byId = new Map(fields.map(field => [field.id, field.text]));
  let pending = fields;
  // One targeted retry repairs residual defects without regenerating the whole block.
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    const revisedById = new Map();
    for (let offset = 0; offset < pending.length; offset += 4) {
      const batch = pending.slice(offset, offset + 4).map(field => ({
        ...field,
        text: byId.get(field.id),
        issues: inspectAcademicStyle(byId.get(field.id))
      }));
      const revised = await reviseFields(apiKey, batch, timeoutMs);
      const batchMap = new Map((Array.isArray(revised) ? revised : []).map(item => [item.id, item.text]));
      for (const field of batch) {
        const revisedText = batchMap.get(field.id);
        if (typeof revisedText !== "string") {
          const error = new Error("Le contrôle stylistique n'a pas corrigé tous les champs requis.");
          error.status = 502;
          throw error;
        }
        revisedById.set(field.id, revisedText);
      }
    }
    for (const field of pending) byId.set(field.id, revisedById.get(field.id));
    pending = fields.filter(field => inspectAcademicStyle(byId.get(field.id)).length > 0);
  }
  flagged.forEach((item, index) => {
    const corrected = byId.get("field-" + index);
    const remaining = inspectAcademicStyle(corrected);
    if (remaining.length) {
      const error = new Error("Le contrôle stylistique n'a pas éliminé tous les défauts après deux tentatives : " + remaining.slice(0, 3).join("; "));
      error.status = 422;
      throw error;
    }
    setAtPath(cloned, item.path, corrected);
  });
  return { value: cloned, correctedFields: flagged.length, checkedFields: countEditableStrings(cloned), issues: flagged.flatMap(item => item.issues) };
}
