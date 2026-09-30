const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
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
  type: "object", additionalProperties: false,
  properties: {
    problematic: {
      type: "object", additionalProperties: false,
      properties: { id:{type:"string"}, title:{type:"string"}, question:{type:"string"}, rationale:{type:"string"}, angle:{type:"string"} },
      required:["id","title","question","rationale","angle"]
    },
    plan: {
      type:"object", additionalProperties:false,
      properties:{
        id:{type:"string"}, title:{type:"string"}, description:{type:"string"}, approach:{type:"string"}, totalWords:{type:"integer"},
        introductionGeneral:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"}},required:["title","description","wordCount"]},
        parts:{
          type:"array",minItems:2,maxItems:3,
          items:{type:"object",additionalProperties:false,properties:{
            title:{type:"string"},description:{type:"string"},
            chapters:{type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{
              title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"},
              sections:{type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{
                title:{type:"string"},description:{type:"string"},
                subsections:{type:"array",minItems:1,maxItems:3,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"}},required:["title","description"]}}
              },required:["title","description","subsections"]}}
            },required:["title","description","wordCount","sections"]}}
          },required:["title","description","chapters"]}
        },
        conclusionGeneral:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"}},required:["title","description","wordCount"]},
        introduction:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"}},required:["title","description","wordCount"]},
        conclusion:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"}},required:["title","description","wordCount"]}
      },
      required:["id","title","description","approach","totalWords","introductionGeneral","parts","conclusionGeneral","introduction","conclusion"]
    },
    introduction:{type:"object",additionalProperties:false,properties:{title:{type:"string"},content:{type:"string"},wordCount:{type:"integer"},incomplete:{type:"boolean"}},required:["title","content","wordCount","incomplete"]}
  },
  required:["problematic","plan","introduction"]
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error:"Méthode non autorisée. Utilisez POST."});
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});

  try {
    const project = req.body?.project || req.body || {};
    const sujet = text(project.sujet || project.subject);
    if (!sujet) return res.status(400).json({error:"Le sujet est obligatoire."});
    const pages = Math.max(1, Number(project.pages || 30));
    const targetWords = pages * WORDS_PER_PAGE;
    const introductionWords = calculateAcademicIntroductionWords(pages);
    const context = [
      "SUJET : " + sujet,
      "DOMAINE : " + (text(project.domaine || project.domain) || "Non précisé"),
      "NIVEAU : " + (text(project.niveau || project.level) || "Non précisé"),
      "TYPE : " + (text(project.typeDoc || project.typeDocument || project.type) || "Mémoire"),
      "CONTEXTE : " + (text(project.contexte || project.context) || "Aucun"),
      "CONSIGNES : " + (text(project.consignes || project.instructions) || "Aucune"),
      "VOLUME : " + pages + " pages, environ " + targetWords + " mots.\nINTRODUCTION GÉNÉRALE : environ " + introductionWords + " mots, soit 10 % du volume total."
    ].join("\n");

    const response = await fetch(OPENAI_URL, {
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
      body:JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        input:[
          {role:"system",content:[{type:"input_text",text:
            "Tu es le moteur d'aperçu gratuit de Trimémo. Génère en un seul appel une problématique, un plan détaillé et un aperçu incomplet d'introduction. Respecte strictement le sujet et les consignes fournies. N'invente aucun terrain, pays, organisation, donnée ou source. Le plan doit être cohérent avec le volume demandé. L'introduction générale complète représente environ 10 % du volume total. Pour l'aperçu gratuit, ne rédige qu'un extrait d'environ 300 mots de cette introduction. Retourne uniquement le JSON demandé."
          }]},
          {role:"user",content:[{type:"input_text",text:context+"\n\nGénère une problématique précise, un plan structuré et une introduction d'aperçu d'environ 300 mots."}]}
        ],
        text:{format:{type:"json_schema",name:"trimemo_free_preview",strict:true,schema}}
      })
    });
    const raw = await response.text();
    if (!response.ok) throw fail("OpenAI a refusé l'aperçu : " + raw.slice(0,700),502);
    const result = parseJson(extractOutputText(JSON.parse(raw)));
    if (!result.problematic?.question || !result.plan?.parts?.length || !result.introduction?.content) throw fail("L'aperçu retourné est incomplet.",502);
    return res.status(200).json({
      success:true,
      problematic:result.problematic,
      plan:result.plan,
      introduction:{...result.introduction,incomplete:true,previewWords:300,targetWords:introductionWords}
    });
  } catch(error) {
    console.error("FREE_PREVIEW_ERROR",error);
    return res.status(error?.status || 500).json({error:error?.message || "Impossible de générer l'aperçu."});
  }
}