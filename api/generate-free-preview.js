import { verifyPricingQuote } from "../lib/pricing.js";
import { setCors } from "../lib/http.js";
import { getOpenAIModel } from "../lib/openai-model.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";
import { rateLimit, rateLimitByKey } from "../lib/rate-limit.js";
import { hydrateProjectFiles } from "../lib/project-file-store.js";
import { deleteOpenAIFiles } from "../lib/project-documents.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles, buildImageInputs } from "../lib/project-documents.js";
import { PLAN_PARTS_SCHEMA, normalizePlanStructure } from "../lib/plan-structure.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;
const FREE_PREVIEW_WORDS = 2500;
const PREVIEW_INTRO_WORDS = 500;

function countWords(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).length;
}

// Conserve les paragraphes entiers. Si un paragraphe dépasse le quota restant,
// ne conserve que ses phrases complètes qui tiennent dans la limite.
function trimToWords(value, limit) {
  const source = String(value || "").trim();
  if (!source || limit <= 0) return "";
  if (countWords(source) <= limit) return source;

  const paragraphs = source.split(/\n\s*\n/u).map((part) => part.trim()).filter(Boolean);
  const kept = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    const paragraphWords = countWords(paragraph);
    if (used + paragraphWords <= limit) {
      kept.push(paragraph);
      used += paragraphWords;
      continue;
    }

    const remaining = limit - used;
    if (remaining > 0) {
      const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) || [];
      const completeSentences = [];
      let sentenceWords = 0;
      for (const sentence of sentences) {
        const nextCount = countWords(sentence);
        if (sentenceWords + nextCount > remaining) break;
        completeSentences.push(sentence.trim());
        sentenceWords += nextCount;
      }
      if (completeSentences.length) kept.push(completeSentences.join(" "));
    }
    break;
  }
  return kept.join("\n\n");
}

function cors(res, req) { setCors(res, req, "POST, OPTIONS"); }
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
    },
    chapterOne:{
      type:"object",additionalProperties:false,
      properties:{
        title:{type:"string",minLength:1},content:{type:"string",minLength:1},wordCount:{type:"integer"}
      },
      required:["title","content","wordCount"]
    }
  },
  required:["problematic","plan","introduction","chapterOne"]
};

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error:"Méthode non autorisée. Utilisez POST."});
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});

  let fileIds = [];
  try {
    let project = req.body?.project || req.body || {};
    const sujet = text(project.sujet || project.subject);
    if (!sujet) return res.status(400).json({error:"Le sujet est obligatoire."});
    await rateLimit(req, "prepayment-preview", 3, 60 * 60 * 1000);
    if (String(project.projectId || project.project_id || "").trim()) await rateLimitByKey("preview-project-" + String(project.projectId || project.project_id).trim(), 3, 24 * 60 * 60 * 1000);
    if (Array.isArray(project.files) && project.files.length) project = await hydrateProjectFiles(project);
    if (!verifyPricingQuote(project.pricingQuoteToken, project)) return res.status(403).json({ error: "L'analyse tarifaire du projet est absente ou expirée. Relancez l'analyse avant l'aperçu." });
    const files = Array.isArray(project.files) ? project.files : [];
    if (files.length) assertFilesSize(files);
    const pages = clampPages(project);
    const targetWords = pages * WORDS_PER_PAGE;
    const introductionWords = calculateAcademicIntroductionWords(pages);
    const documentContext = project.documentContext || (files.length ? await buildProjectDocumentContext(files) : {});
    fileIds = files.length ? await uploadProjectFiles(files, apiKey) : [];
    const imageInputs = buildImageInputs(files);
    const context = [
      "SUJET : " + sujet,
      "DOMAINE : " + (text(project.domaine || project.domain) || "Non précisé"),
      "NIVEAU : " + (text(project.niveau || project.level) || "Non précisé"),
      "TYPE : " + (text(project.typeDoc || project.typeDocument || project.type) || "Mémoire"),
      "CONTEXTE : " + (text(project.contexte || project.context) || "Aucun"),
      "CONSIGNES : " + (text(project.consignes || project.instructions) || "Aucune"),
      "PROBLÉMATIQUE PERSONNELLE : " + (text(project.problematiquePersonnelle || project.problematique || project.problematic) || "Aucune"),
      "PLAN PERSONNEL : " + (text(project.planPersonnel || project.plan) || "Aucun"),
      "PROBLÉMATIQUE VALIDÉE PAR LE CLIENT : " + JSON.stringify(req.body?.problematic || {}),
      "PLAN VALIDÉ PAR LE CLIENT : " + JSON.stringify(req.body?.plan || {}),
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
           {role:"user",content:[{type:"input_text",text:context+"\n\nSi une problématique validée et un plan validé sont fournis dans le contexte, conserve-les exactement et rédige à partir d'eux. Génère une problématique précise et un plan seulement si le client n'en a pas fourni. Rédige ensuite un aperçu total de 2 500 mots maximum allant de l'introduction générale au premier chapitre de la première partie. Vise environ 500 mots pour l'introduction et utilise le volume restant pour le premier chapitre, sans dépasser 2 500 mots au total. Le chapitre doit suivre exactement les sections du plan validé et comporter des titres de section explicites. Le texte doit permettre au client d'évaluer la qualité avant paiement. N'ajoute aucun résultat empirique inventé.
MISE EN FORME OBLIGATOIRE : l'introduction générale doit comporter plusieurs paragraphes distincts séparés par une ligne vide, chacun développant une idée précise. Ne retourne jamais l'introduction comme un bloc unique. Chaque titre de partie, chapitre ou section doit être seul sur sa ligne, séparé du texte par une ligne vide. Le chapitre doit commencer par les intitulés exacts « PARTIE I : [titre de la première partie] » puis « CHAPITRE 1 : [titre du premier chapitre] », avant ses sections, sans inventer ni modifier les titres du plan. Aucun paragraphe explicatif ne doit être entièrement en gras. N'utilise pas de retours à la ligne après chaque phrase : forme des paragraphes cohérents de plusieurs phrases."+correction},...fileIds.map(file_id=>({type:"input_file",file_id})),...imageInputs]}
        ],
        max_output_tokens:12000,
        text:{format:{type:"json_schema",name:"trimemo_free_preview",strict:true,schema}}
      })});
      const raw=await response.text();
      if(!response.ok){let detail="Le service de génération a refusé la requête.";try{const e=JSON.parse(raw);detail=e?.error?.message||detail}catch{}throw fail("OpenAI a refusé l'aperçu : "+detail,502);}
      const candidate=parseJson(extractOutputText(JSON.parse(raw)));
      const chapterOneWords = String(candidate?.chapterOne?.content || "").trim().split(/\s+/u).filter(Boolean).length;
      if (chapterOneWords < 800) {
        lastValidationReason = "Le premier chapitre doit contenir au moins 800 mots pour permettre une véritable évaluation de la qualité.";
        continue;
      }
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
    if (!result.problematic?.question || !result.plan?.parts?.length || !result.introduction?.content || !result.chapterOne?.content) throw fail("L'aperçu retourné est incomplet.",502);
    const selectedProblematic = req.body?.problematic;
    const selectedPlan = req.body?.plan;
    if (selectedProblematic?.question) result.problematic = selectedProblematic;
    if (Array.isArray(selectedPlan?.parts) && selectedPlan.parts.length) result.plan = normalizePlanStructure(selectedPlan, 0, targetWords);
    const normalizedPlan = normalizePlanStructure(result.plan, 0, targetWords);
    if (selectedPlan?.id) normalizedPlan.id = String(selectedPlan.id);
    const firstPart = result.plan.parts[0];
    const firstChapter = firstPart?.chapters?.[0];
    if (!firstChapter) throw fail("Le premier chapitre est absent du plan.",502);
    const introductionContent = trimToWords(result.introduction.content, PREVIEW_INTRO_WORDS);
    const remainingPreviewWords = Math.max(0, FREE_PREVIEW_WORDS - introductionContent.split(/\s+/u).filter(Boolean).length);
    const chapterContent = trimToWords(String(result.chapterOne.content).trim(), remainingPreviewWords);
    return res.status(200).json({
      success:true,
      previewWordLimit:FREE_PREVIEW_WORDS,
      problematic:result.problematic,
      plan:normalizedPlan,
      introduction:{...result.introduction,content:introductionContent,wordCount:introductionContent.split(/\s+/u).filter(Boolean).length,incomplete:true,previewWords:FREE_PREVIEW_WORDS,targetWords:introductionWords},
      chapterOne:{...result.chapterOne,title:firstChapter.title || result.chapterOne.title,content:chapterContent,wordCount:chapterContent.split(/\s+/u).filter(Boolean).length,partTitle:firstPart.title || "",chapterNumber:firstChapter.number || 1,sectionTitles:(firstChapter.sections || []).map(section=>section.title)}
    });
  } catch(error) {
    await deleteOpenAIFiles(fileIds, apiKey);
    console.error("FREE_PREVIEW_FAILED", { status: Number(error?.status) || 500, code: String(error?.code || "PREVIEW_GENERATION_ERROR") });
    const status = error?.status || 500;
    return res.status(status).json({error: status >= 500 ? "Impossible de générer l’aperçu pour le moment. Réessayez dans quelques instants." : (error?.message || "Requête invalide.")});
  }
}