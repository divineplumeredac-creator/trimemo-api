import { getOpenAIModel } from "../lib/openai-model.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";
import { rateLimit } from "../lib/rate-limit.js";
import { deleteOpenAIFiles } from "../lib/project-documents.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles } from "../lib/project-documents.js";
import { PLAN_PARTS_SCHEMA, normalizePlanStructure, validatePlanSet } from "../lib/plan-structure.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;
const FREE_PREVIEW_WORDS = 320;

function trimToWords(value, limit) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return words.slice(0, limit).join(" ") + "…";
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", String(process.env.TRIMEMO_FRONTEND_URL || ""));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}
function fail(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function text(v) { return String(v ?? "").trim(); }
function calculateAcademicIntroductionWords(pages) { return Math.max(300, Math.round(Number(pages || 1) * WORDS_PER_PAGE * 0.10)); }
function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = Array.isArray(data?.output) ? data.output.flatMap(x => Array.isArray(x?.content) ? x.content : []) : [];
  const out = parts.filter(x => x?.type === "output_text" && typeof x.text === "string").map(x => x.text).join("\n").trim();
  if (!out) throw fail("OpenAI n'a retourné aucun contenu exploitable.", 502);
  return out;
}
function parseJson(value) {
  try { return JSON.parse(value); } catch {
    const a = value.indexOf("{"), b = value.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(value.slice(a, b + 1));
    throw fail("La réponse OpenAI n'est pas un JSON valide.", 502);
  }
}
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    problematic: {
      type: "object", additionalProperties: false,
      properties: {
        id:{type:"string",minLength:1}, title:{type:"string",minLength:1}, question:{type:"string",minLength:1},
        rationale:{type:"string",minLength:1}, angle:{type:"string",minLength:1}
      },
      required:["id","title","question","rationale","angle"]
    },
    plan: {
      type:"object", additionalProperties:false,
      properties:{
        id:{type:"string",minLength:1}, title:{type:"string",minLength:1}, description:{type:"string",minLength:1},
        approach:{type:"string",minLength:1}, totalWords:{type:"integer"},
        introductionGeneral:{
          type:"object",additionalProperties:false,
          properties:{title:{type:"string",minLength:1},description:{type:"string",minLength:1},wordCount:{type:"integer"}},
          required:["title","description","wordCount"]
        },
        parts:PLAN_PARTS_SCHEMA,
        conclusionGeneral:{
          type:"object",additionalProperties:false,
          properties:{title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"}},
          required:["title","description","wordCount"]
        }
      },
      required:["id","title","description","approach","totalWords","introductionGeneral","parts","conclusionGeneral"]
    },
    introduction:{
      type:"object",additionalProperties:false,
      properties:{
        title:{type:"string",minLength:1},content:{type:"string",minLength:1},wordCount:{type:"integer"},incomplete:{type:"boolean"}
      },
      required:["title","content","wordCount","incomplete"]
    }
  },
  required:["problematic","plan","introduction"]
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error:"Méthode non autorisée. Utilisez POST."});
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});

  let fileIds = [];
  try {
    const project = req.body?.project || req.body || {};
    const sujet = text(project.sujet || project.subject);
    if (!sujet) return res.status(400).json({error:"Le sujet est obligatoire."});
    await rateLimit(req, "free-preview", 5, 60 * 60 * 1000);
    const files = Array.isArray(project.files) ? project.files : [];
    if (files.length) assertFilesSize(files);
    const pages = clampPages(project);
    const targetWords = pages * WORDS_PER_PAGE;
    const introductionWords = calculateAcademicIntroductionWords(pages);
    const documentContext = files.length ? await buildProjectDocumentContext(files) : {};
    fileIds = files.length ? await uploadProjectFiles(files, apiKey) : [];
    const context = [
      "SUJET : " + sujet,
      "DOMAINE : " + (text(project.domaine || project.domain) || "Non précisé"),
      "NIVEAU : " + (text(project.niveau || project.level) || "Non précisé"),
      "TYPE : " + (text(project.typeDoc || project.typeDocument || project.type) || "Mémoire"),
      "CONTEXTE : " + (text(project.contexte || project.context) || "Aucun"),
      "CONSIGNES : " + (text(project.consignes || project.instructions) || "Aucune"),
      "PROBLÉMATIQUE PERSONNELLE : " + (text(project.problematiquePersonnelle || project.problematique || project.problematic) || "Aucune"),
      "PLAN PERSONNEL : " + (text(project.planPersonnel || project.plan) || "Aucun"),
      buildDocumentInstructions(documentContext),
      "VOLUME : " + pages + " pages, environ " + targetWords + " mots.\nINTRODUCTION GÉNÉRALE : environ " + introductionWords + " mots, soit 10 % du volume total."
    ].join("\n");

    const response = await fetch(OPENAI_URL, {
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
      body:JSON.stringify({
        model: getOpenAIModel(),
        input:[
          {role:"system",content:[{type:"input_text",text:
            TRIMEMO_MASTER_ACADEMIC_RULES + `\n\nEXCEPTION SPÉCIFIQUE À L'APERÇU GRATUIT : le SUJET est la seule information obligatoire. Ne bloque jamais la génération et ne demande jamais au client de préciser le niveau, la discipline, l'état d'avancement, le contexte, les consignes, un guide méthodologique ou un plan personnel lorsqu'ils ne sont pas fournis. Lorsqu'une information manque, adapte simplement la proposition au sujet et indique seulement les limites réellement pertinentes. Génère un résultat académique concret à partir du sujet seul. Cette règle prévaut sur toute instruction générale de vérification préalable qui pourrait empêcher l'aperçu gratuit.\n\nTu es le moteur d'aperçu gratuit de Trimémo. Génère en un seul appel une problématique, un plan détaillé et un aperçu incomplet d'introduction. Les consignes, informations, contexte, problématique et plan fournis par le client sont prioritaires. Respecte strictement les éléments fournis. N'invente aucun terrain, pays, organisation, donnée ou source. Le plan doit être cohérent avec le volume demandé. L'introduction générale complète représente environ 10 % du volume total.
Le plan doit comporter 2 ou 3 parties selon le sujet.
Chaque partie comporte 2 ou 3 chapitres, sans obligation d'en avoir 3.
Chaque chapitre comporte au moins 2 sections.
Les sous-sections sont facultatives lorsque le contenu reste inférieur au seuil de structuration.
Toute section dont le contenu prévu dépasse 320 mots doit être subdivisée en sous-sections pertinentes.
Toute sous-section dont le contenu prévu dépasse 320 mots doit être subdivisée par des titres internes pertinents.
Les titres internes doivent correspondre à de véritables idées et ne doivent jamais être artificiels.
La structure doit varier naturellement à l'intérieur du plan : ne donne pas le même nombre de chapitres à toutes les parties ni le même nombre de sections à tous les chapitres lorsque le contenu ne le justifie pas.
La variation doit découler du sujet, de la problématique, du niveau, du volume et des consignes.
N'ajoute aucun niveau uniquement pour créer une symétrie visuelle. Pour l'aperçu gratuit, rédige un extrait d'environ 320 mots. Le serveur plafonnera l'extrait à 320 mots. Retourne uniquement le JSON demandé.`
          }]},
          {role:"user",content:[{type:"input_text",text:context+"\n\nGénère une problématique précise, un plan structuré et une introduction d'aperçu d'environ 320 mots."}]}
        ],
        max_output_tokens:8000,
        text:{format:{type:"json_schema",name:"trimemo_free_preview",strict:true,schema}}
      })
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = "Le service de génération a refusé la requête.";
      try {
        const errorData = JSON.parse(raw);
        detail = errorData?.error?.message || detail;
      } catch {}
      throw fail("OpenAI a refusé l'aperçu : " + detail, 502);
    }
    const result = parseJson(extractOutputText(JSON.parse(raw)));
    await deleteOpenAIFiles(fileIds, apiKey);
    fileIds = [];
    if (!result.problematic?.question || !result.plan?.parts?.length || !result.introduction?.content) throw fail("L'aperçu retourné est incomplet.",502);
    return res.status(200).json({
      success:true,
      problematic:result.problematic,
      plan:result.plan,
      introduction:{...result.introduction,content:trimToWords(result.introduction.content, FREE_PREVIEW_WORDS),wordCount:Math.min(FREE_PREVIEW_WORDS, trimToWords(result.introduction.content, FREE_PREVIEW_WORDS).split(/\s+/).filter(Boolean).length),incomplete:true,previewWords:FREE_PREVIEW_WORDS,targetWords:introductionWords}
    });
  } catch(error) {
    await deleteOpenAIFiles(fileIds, apiKey);
    console.error("FREE_PREVIEW_ERROR",error);
    return res.status(error?.status || 500).json({error:error?.message || "Impossible de générer l'aperçu."});
  }
}