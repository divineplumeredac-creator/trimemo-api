import { getClaudeModel, claudeFetch } from "./claude-client.js";
import { recordOpenAIUsage } from "./admin-telemetry.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";

const IMMUTABLE_KEYS = new Set([
  "id", "url", "doi", "author", "year", "isbn", "issn", "wordcount",
  "pagecount", "sources", "bibliography", "citations", "references",
  "footnotes", "citation", "reference", "structure", "createdat", "updatedat",
  // Structural metadata is not body prose and must not block a document export.
  "title", "description", "question", "rationale", "angle", "approach", "number", "kind", "type", "id"
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

async function reviseFields(apiKey, fields, timeoutMs, retry = 0, projectId) {
  const requestStartedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await claudeFetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: getClaudeModel("light"),
        thinking: { type: "disabled" },
        native_json_schema: true,
        max_output_tokens: Math.min(16000, Math.max(retry ? 5000 : 2500, Math.ceil(fields.reduce((n, field) => n + field.text.length, 0) / 2) + 1000) * (retry ? 2 : 1)),
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `Tu es le correcteur stylistique obligatoire de Trimémo. Révise uniquement les champs fournis.
Règles impératives : chaque phrase contient au maximum 20 mots, sauf exception strictement nécessaire à la précision; supprime le tiret long « — »; élimine les répétitions exactes, les connecteurs mécaniques répétés, les clichés et les formulations vagues. Supprime tout métadiscours éditorial, commentaire technique ou instruction sur ce qu’il faudrait rédiger. Le texte doit exposer directement le raisonnement scientifique, sans annoncer les développements futurs.
Préserve strictement le sens scientifique, les nuances, les termes disciplinaires, les données, les citations intégrées et la position argumentative. N'ajoute aucun fait, résultat, auteur, chiffre ou source. Ne modifie pas le contenu factuel. N'introduis aucun tiret long.
PRÉSERVATION DE LA MISE EN PAGE : conserve exactement les séparations entre paragraphes présentes dans chaque champ. Ne fusionne jamais deux paragraphes distincts. Ne transforme jamais chaque phrase en paragraphe. À l'intérieur d'un paragraphe, conserve les phrases qui développent la même idée. Les retours à la ligne simples sont des retours souples, pas des changements de paragraphe. Ne crée une nouvelle séparation que si elle existe déjà dans le texte source.\nRetourne chaque identifiant une seule fois avec son texte corrigé. Ne fusionne pas les champs et ne change pas leurs identifiants. La sortie doit être un JSON conforme au schéma.`
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
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  void recordOpenAIUsage({
    endpoint: "style-control",
    model: getClaudeModel("light"),
    usage: data?.usage,
    status: response.ok ? (data?.status === "incomplete" ? "incomplete" : "success") : "error",
    durationMs: Date.now() - requestStartedAt,
    requestId: data?.id,
    errorCode: response.ok ? (data?.status === "incomplete" ? "INCOMPLETE" : null) : "OPENAI_HTTP_" + response.status,
    itemCount: fields.length,
    projectId,
  });
  if (!response.ok) {
    const message = data?.error?.message || raw;
    const error = new Error("Contrôle stylistique indisponible : " + String(message).slice(0, 500));
    error.status = 502;
    throw error;
  }
  if (!data || typeof data !== "object" || !Object.keys(data).length) {
    const error = new Error("Réponse invalide du contrôle stylistique.");
    error.status = 502;
    throw error;
  }
  const output = extractOutputText(data);
  try {
    if (data?.status === "incomplete") throw new Error("Réponse incomplète.");
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
        outputLength: output.length
      });
      return reviseFields(apiKey, fields, timeoutMs, retry + 1, projectId);
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
export async function enforceAcademicStyle(value, { apiKey = process.env.TRIMEMO_CLAUDE_API_KEY, timeoutMs = 30000, batchSize = 4, projectId } = {}) {
  const cloned = JSON.parse(JSON.stringify(value));
  const flagged = collectEditableStrings(cloned);
  if (!flagged.length) {
    return { value: cloned, correctedFields: 0, checkedFields: countEditableStrings(cloned), issues: [] };
  }
  if (!apiKey) {
    const error = new Error("TRIMEMO_CLAUDE_API_KEY est absente : contrôle stylistique impossible.");
    error.status = 500;
    throw error;
  }
  // Correct each existing paragraph separately: large blocks formerly exceeded
  // the response budget and caused the entire correction to be discarded.
  const partsByField = flagged.map(item => item.text.split(/(\n\s*\n+)/u));
  const fields = [];
  partsByField.forEach((parts, index) => parts.forEach((part, partIndex) => {
    if (partIndex % 2 === 0 && part.trim() && inspectAcademicStyle(part).length) {
      fields.push({ id: `field-${index}-part-${partIndex}`, text: part, issues: inspectAcademicStyle(part), index, partIndex });
    }
  }));
  const byId = new Map(fields.map(field => [field.id, field.text]));
  let pending = fields;
  // One targeted retry repairs residual defects without regenerating the whole block.
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    const revisedById = new Map();
    const safeBatchSize = Math.max(1, Math.min(4, Number(batchSize) || 4));
    for (let offset = 0; offset < pending.length;) {
      let end = offset;
      let words = 0;
      while (end < pending.length && end - offset < safeBatchSize) {
        const nextWords = wordCount(byId.get(pending[end].id));
        if (end > offset && words + nextWords > 700) break;
        words += nextWords; end++;
      }
      const batch = pending.slice(offset, end).map(field => ({
        ...field,
        text: byId.get(field.id),
        issues: inspectAcademicStyle(byId.get(field.id))
      }));
      offset = end;
      const revised = await reviseFields(apiKey, batch, timeoutMs, 0, projectId);
      const batchMap = new Map((Array.isArray(revised) ? revised : []).map(item => [item.id, item.text]));
      for (const field of batch) {
        const revisedText = batchMap.get(field.id);
        if (typeof revisedText !== "string") {
          const error = new Error("Le contrôle stylistique n'a pas corrigé tous les champs requis.");
          error.status = 502;
          throw error;
        }
        // Never silently remove figures or author-date citations during a
        // cosmetic rewrite. On failure callers retain the original document.
        const evidence = text => (String(text).match(/\((?:[^()]*\b(?:19|20)\d{2}[^()]*)\)|\b\d+(?:[.,]\d+)?\s*%?/gu) || []).map(s => s.replace(/\s+/gu, " ").trim()).sort();
        if (JSON.stringify(evidence(revisedText)) !== JSON.stringify(evidence(field.text))) {
          const error = new Error("Le contrôle stylistique a modifié une citation ou une donnée ; le texte initial est conservé.");
          error.status = 422;
          throw error;
        }
        if (wordCount(field.text) >= 20 && wordCount(revisedText) < wordCount(field.text) * 0.6) {
          const error = new Error("Le contrôle stylistique a trop réduit le texte ; le texte initial est conservé.");
          error.status = 422;
          throw error;
        }
        revisedById.set(field.id, revisedText);
      }
    }
    for (const field of pending) byId.set(field.id, revisedById.get(field.id));
    pending = fields.filter(field => inspectAcademicStyle(byId.get(field.id)).length > 0);
  }
  flagged.forEach((item, index) => {
    const parts = partsByField[index];
    for (const field of fields.filter(field => field.index === index)) parts[field.partIndex] = byId.get(field.id);
    const corrected = parts.join("");
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
