import { isOwnerRequest, requireOwner } from "../lib/owner-auth.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
}

function text(value) {
  return String(value ?? "").trim();
}

function problematicText(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return text(value.question || value.title || value.titre || value.texte);
  }
  return "";
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === "output_text" && typeof part.text === "string") parts.push(part.text);
      if (part?.type === "refusal" && part.refusal) throw new Error(`OpenAI a refusé la génération : ${part.refusal}`);
    }
  }
  const result = parts.join("\n").trim();
  if (!result) throw new Error("OpenAI n’a retourné aucun texte exploitable.");
  return result;
}

function parseJson(value) {
  try { return JSON.parse(value); } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(value.slice(first, last + 1));
    throw new Error("La réponse OpenAI n’est pas un JSON valide.");
  }
}

function planSchema() {
  const subsection = {
    type: "object", additionalProperties: false,
    properties: { id:{type:"string"}, number:{type:"integer"}, title:{type:"string"}, description:{type:"string"} },
    required: ["id","number","title","description"]
  };
  const section = {
    type: "object", additionalProperties: false,
    properties: { id:{type:"string"}, number:{type:"integer"}, title:{type:"string"}, description:{type:"string"}, subsections:{type:"array",items:subsection} },
    required: ["id","number","title","description","subsections"]
  };
  const chapter = {
    type: "object", additionalProperties: false,
    properties: { id:{type:"string"}, number:{type:"integer"}, title:{type:"string"}, description:{type:"string"}, wordCount:{type:"integer"}, sections:{type:"array",items:section} },
    required: ["id","number","title","description","wordCount","sections"]
  };
  const part = {
    type: "object", additionalProperties: false,
    properties: { id:{type:"string"}, number:{type:"integer"}, title:{type:"string"}, description:{type:"string"}, chapters:{type:"array",items:chapter} },
    required: ["id","number","title","description","chapters"]
  };
  const intro = {
    type: "object", additionalProperties: false,
    properties: { title:{type:"string"}, description:{type:"string"}, wordCount:{type:"integer"} },
    required: ["title","description","wordCount"]
  };
  const plan = {
    type: "object", additionalProperties: false,
    properties: { id:{type:"string"}, title:{type:"string"}, description:{type:"string"}, approach:{type:"string"}, totalWords:{type:"integer"}, introductionGeneral:intro, parts:{type:"array",items:part}, conclusionGeneral:intro },
    required: ["id","title","description","approach","totalWords","introductionGeneral","parts","conclusionGeneral"]
  };
  return { type:"object", additionalProperties:false, properties:{plans:{type:"array",minItems:1,maxItems:3,items:plan}}, required:["plans"] };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });

  const body = req.body || {};
  try {
    if (isOwnerRequest(body)) requireOwner(req);

    const project = body.project || {};
    const sujet = text(body.sujet || project.sujet || project.subject);
    const domaine = text(body.domaine || project.domaine || project.domain) || "Non précisé";
    const niveau = text(body.niveau || project.niveau || project.level) || "Master";
    const typeDoc = text(body.typeDoc || project.typeDoc || project.typeDocument) || "Mémoire";
    const consignes = text(body.consignes || project.consignes || project.instructions);
    const problematic = problematicText(body.problematic || body.problematique);
    const requestedCount = Math.min(3, Math.max(1, Number(body.count) || 1));

    if (!sujet) return res.status(400).json({ error: "Le sujet est obligatoire." });
    if (!problematic) return res.status(400).json({ error: "Sélectionnez une problématique avant de générer les plans." });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY est absente des variables Vercel." });
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

    const systemPrompt = `Tu es un concepteur de plans universitaires. Produis exactement ${requestedCount} plan(s) détaillé(s), adapté(s) au sujet et à la problématique. Chaque plan doit comporter id, title, description, approach, totalWords, introductionGeneral, parts et conclusionGeneral. Chaque partie comporte des chapitres, chaque chapitre des sections, et chaque section peut comporter des subsections. Tous les éléments doivent contenir id, number, title et description, et chaque chapitre doit contenir wordCount. Ne fabrique aucune source, donnée ou terrain. Si plusieurs plans sont demandés, leurs logiques doivent être distinctes. Réponds uniquement avec le JSON demandé.`;
    const userPrompt = `SUJET:\n${sujet}\n\nDOMAINE:\n${domaine}\n\nNIVEAU:\n${niveau}\n\nTYPE:\n${typeDoc}\n\nPROBLÉMATIQUE:\n${problematic}\n\nCONSIGNES:\n${consignes || "Aucune"}\n\nGénère exactement ${requestedCount} plan(s).`;

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [
          { role:"system", content:[{type:"input_text",text:systemPrompt}] },
          { role:"user", content:[{type:"input_text",text:userPrompt}] }
        ],
        text: { format: { type:"json_schema", name:"trimemo_plans", strict:true, schema:planSchema() } }
      })
    });

    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { return res.status(502).json({ error:"Réponse OpenAI invalide.", providerStatus:response.status }); }
    if (!response.ok) return res.status(502).json({ error:data?.error?.message || "OpenAI a refusé la génération des plans.", providerStatus:response.status });

    const parsed = parseJson(extractOutputText(data));
    const plans = Array.isArray(parsed?.plans) ? parsed.plans : [];
    if (plans.length !== requestedCount) return res.status(502).json({ error:`OpenAI a retourné ${plans.length} plan(s), ${requestedCount} demandé(s).` });
    for (const plan of plans) {
      if (!plan?.title || !Array.isArray(plan.parts) || !plan.parts.length || !plan.introductionGeneral || !plan.conclusionGeneral) {
        return res.status(502).json({ error:"La structure d’un plan retourné est incomplète." });
      }
    }
    return res.status(200).json({ plans, meta:{ model, count:plans.length, subject:sujet } });
  } catch (error) {
    return res.status(Number(error?.status) || 502).json({ error:error?.message || "Erreur lors de la génération des plans." });
  }
}
