import { getOpenAIModel } from "../lib/openai-model.js";
import { buildProjectDocumentContext } from "../lib/project-documents.js";
import { assertFilesSize } from "../lib/limits.js";
import { rateLimit } from "../lib/rate-limit.js";
import { calculateQuote, marketForCountry, signPricingQuote } from "../lib/pricing.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";
function cors(res, req) {
  const origin = String(req?.headers?.origin || "").trim().replace(/\/$/, "");
  const allowed = origin === "https://trimemo-frontend.vercel.app" || /^https:\/\/trimemo-frontend-[a-z0-9-]+\.vercel\.app$/i.test(origin) ? origin : "https://trimemo-frontend.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}
function fail(res, status, error, details) { return res.status(status).json({ error, ...(details ? { details } : {}) }); }
function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  return (Array.isArray(data?.output) ? data.output.flatMap(x => Array.isArray(x?.content) ? x.content : []) : [])
    .filter(x => x?.type === "output_text" && typeof x.text === "string").map(x => x.text).join("\n").trim();
}
function countryFromRequest(req, project) {
  const header = req.headers?.["x-vercel-ip-country"] || req.headers?.["cf-ipcountry"] || req.headers?.["x-country-code"];
  const candidate = String(header || project.country || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(candidate) ? candidate : "UNKNOWN";
}
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Utilisez POST.");
  if (!process.env.OPENAI_API_KEY) return fail(res, 500, "OPENAI_API_KEY est absente du serveur.");
  const project = req.body?.project || {};
  if (!String(project.sujet || project.subject || "").trim()) return fail(res, 400, "Le sujet du projet est obligatoire.");
  const pages = Number(project.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > 300) return fail(res, 400, "Le volume doit être un nombre entier compris entre 1 et 300 pages.");
  try {
    await rateLimit(req, "project-estimate", 8, 60 * 60 * 1000);
    const files = Array.isArray(project.files) ? project.files : [];
    if (files.length) assertFilesSize(files);
    const documents = files.length ? await buildProjectDocumentContext(files) : {};
    const country = countryFromRequest(req, project);
    const market = marketForCountry(country);
    const evidence = [
      "Sujet : " + String(project.sujet || "").slice(0, 1500),
      "Type de document : " + String(project.typeDoc || "Mémoire"),
      "Niveau déclaré : " + String(project.niveau || "Non précisé"),
      "Domaine : " + String(project.domaine || "Non précisé"),
      "Volume demandé : " + pages + " pages normalisées de 320 mots",
      "Contexte : " + String(project.contexte || "").slice(0, 3000),
      "Consignes : " + String(project.consignes || "").slice(0, 5000),
      "Guide et documents extraits : " + String(documents.allText || "Aucun guide fourni").slice(0, 12000),
    ].join("\n\n");
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOpenAIModel(),
        input: [
          { role: "system", content: [{ type: "input_text", text:
            "Tu es l'analyste de cadrage tarifaire de Trimémo. Évalue uniquement la complexité de production académique, jamais la capacité financière individuelle. Les consignes et le guide méthodologique du projet sont prioritaires. Classe la complexité en faible, moyenne ou elevee selon les exigences réelles : niveau d'analyse, méthode, données empiriques, discipline technique, nombre de contraintes, ampleur du guide et exigences de sources. N'invente pas d'exigence absente. Donne 2 à 5 raisons concrètes et courtes. Ne calcule aucun prix : le serveur applique la grille tarifaire déterministe." }] },
          { role: "user", content: [{ type: "input_text", text: evidence }] }
        ],
        max_output_tokens: 700,
        text: { format: { type: "json_schema", name: "trimemo_project_complexity", strict: true, schema: {
          type: "object", additionalProperties: false,
          properties: {
            complexity: { type: "string", enum: ["faible", "moyenne", "elevee"] },
            reasons: { type: "array", items: { type: "string" } },
            detectedRequirements: { type: "array", items: { type: "string" } }
          },
          required: ["complexity", "reasons", "detectedRequirements"]
        } } }
      })
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    if (!response.ok) return fail(res, 502, data?.error?.message || "L'analyse du projet par OpenAI a échoué.");
    let analysis;
    try { analysis = JSON.parse(extractText(data)); } catch { return fail(res, 502, "Le moteur n'a pas retourné une analyse exploitable."); }
    if (!["faible", "moyenne", "elevee"].includes(analysis.complexity)) return fail(res, 502, "La complexité détectée est invalide.");
    const quote = calculateQuote({ project: { ...project, pages }, country, complexity: analysis.complexity, reasons: analysis.reasons });
    quote.detectedRequirements = Array.isArray(analysis.detectedRequirements) ? analysis.detectedRequirements.slice(0, 8) : [];
    quote.countryDetected = country !== "UNKNOWN";
    quote.pricingQuoteToken = signPricingQuote(quote, { ...project, pages });
    return res.status(200).json({ success: true, estimate: quote });
  } catch (error) {
    console.error("TRIMEMO_PROJECT_ESTIMATE_ERROR", error);
    return fail(res, error?.status || 500, error?.message || "Impossible d'estimer le projet.");
  }
}
