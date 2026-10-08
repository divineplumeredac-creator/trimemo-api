import { getOpenAIModel } from "../lib/openai-model.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";
import { rateLimit } from "../lib/rate-limit.js";
import { deleteOpenAIFiles } from "../lib/project-documents.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles } from "../lib/project-documents.js";
import { PLAN_PARTS_SCHEMA, normalizePlanStructure } from "../lib/plan-structure.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;
const FREE_PREVIEW_WORDS = 320;

function trimToWords(value, limit) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return words.slice(0, limit).join(" ") + "…";
}

function cors(res, req) {
  const origin = String(req?.headers?.origin || "").trim().replace(/\/$/, "");
  const allowed = origin === "https://trimemo-frontend.vercel.app" || /^https:\/\/trimemo-frontend-[a-z0-9-]+\.vercel\.app$/i.test(origin) ? origin : "https://trimemo-frontend.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Vary", "Origin");
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
  cors(res, req);
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

    let result=null;
    let lastValidationReason="";
    for(let attempt=0;attempt<3;attempt++){
      const correction=attempt===0?"":"\n\nCONTRÔLE STRUCTUREL : le plan précédent a été rejeté : "+lastValidationReason+". Régénère le plan en corrigeant ce défaut. Les titres ne doivent contenir aucune numérotation.";
      const response=await fetch(OPENAI_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify({
        model:getOpenAIModel(),
        input:[
          {role:"system",content:[{type:"input_text",text:TRIMEMO_MASTER_ACADEMIC_RULES+"\n\nEXCEPTION APERÇU GRATUIT : le SUJET est la seule information obligatoire. Ne bloque jamais la génération pour une donnée facultative. Génère à partir du sujet seul si nécessaire. Les sous-sections sont facultatives et doivent être justifiées par la densité du contenu. Toute numérotation est ajoutée par Trimémo après validation. Ne mets aucun numéro dans les titres. N'ajoute aucun niveau pour créer une symétrie artificielle. Retourne uniquement le JSON."+correction}]},
          {role:"user",content:[{type:"input_text",text:context+"\n\nGénère une problématique précise, un plan structuré et une introduction d'aperçu d'environ 320 mots."+correction}]}
        ],
        max_output_tokens:8000,
        text:{format:{type:"json_schema",name:"trimemo_free_preview",strict:true,schema}}
      })});
      const raw=await response.text();
      if(!response.ok){let detail="Le service de génération a refusé la requête.";try{const e=JSON.parse(raw);detail=e?.error?.message||detail}catch{}throw fail("OpenAI a refusé l'aperçu : "+detail,502);}
      const candidate=parseJson(extractOutputText(JSON.parse(raw)));
      const plan=candidate?.plan;
      const parts=Array.isArray(plan?.parts)?plan.parts:[];
      const validStructure=parts.length>=2 && parts.length<=3 && parts.every(part=>{
        const chapters=Array.isArray(part?.chapters)?part.chapters:[];
        return chapters.length>=2 && chapters.length<=3 && chapters.every(chapter=>{
          const sections=Array.isArray(chapter?.sections)?chapter.sections:[];
          return sections.length>=2 && sections.length<=3;
        });
      });
      if(!validStructure){
        lastValidationReason="Le plan doit comporter 2 ou 3 parties, 2 ou 3 chapitres par partie et 2 ou 3 sections par chapitre.";
        continue;
      }
      result=candidate;
      break;
    }
    if(!result) throw fail("L’aperçu gratuit n’a pas produit une structure académique conforme après trois tentatives : "+lastValidationReason,502);
    await deleteOpenAIFiles(fileIds, apiKey);
    fileIds = [];
    if (!result.problematic?.question || !result.plan?.parts?.length || !result.introduction?.content) throw fail("L'aperçu retourné est incomplet.",502);
    return res.status(200).json({
      success:true,
      problematic:result.problematic,
      plan:normalizePlanStructure(result.plan,0,targetWords),
      introduction:{...result.introduction,content:trimToWords(result.introduction.content, FREE_PREVIEW_WORDS),wordCount:Math.min(FREE_PREVIEW_WORDS, trimToWords(result.introduction.content, FREE_PREVIEW_WORDS).split(/\s+/).filter(Boolean).length),incomplete:true,previewWords:FREE_PREVIEW_WORDS,targetWords:introductionWords}
    });
  } catch(error) {
    await deleteOpenAIFiles(fileIds, apiKey);
    console.error("FREE_PREVIEW_ERROR",error);
    return res.status(error?.status || 500).json({error:error?.message || "Impossible de générer l'aperçu."});
  }
}