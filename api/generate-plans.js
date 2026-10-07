import { getOpenAIModel } from "../lib/openai-model.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles, deleteOpenAIFiles } from "../lib/project-documents.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";
import { PLAN_PARTS_SCHEMA, normalizePlanStructure, validatePlanSet } from "../lib/plan-structure.js";

const OPENAI_URL="https://api.openai.com/v1/responses";
const WORDS_PER_PAGE=320;

function cors(res){
  res.setHeader("Access-Control-Allow-Origin",String(process.env.TRIMEMO_FRONTEND_URL || ""));
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");
}
function fail(m,s=400){const e=new Error(m);e.status=s;return e}
function txt(v){return String(v??"").trim()}
function out(d){
  if(d?.output_text?.trim()) return d.output_text.trim();
  const t=(d?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text).join("").trim();
  if(!t) throw fail("OpenAI n’a retourné aucun plan exploitable.",502);
  return t;
}
function json(v){
  try{return JSON.parse(v)}catch{
    const a=v.indexOf("{"),b=v.lastIndexOf("}");
    if(a>=0&&b>a)return JSON.parse(v.slice(a,b+1));
    throw fail("Réponse OpenAI invalide.",502);
  }
}

const SCHEMA={
  type:"object",
  additionalProperties:false,
  properties:{
    plans:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        properties:{
          title:{type:"string"},
          approach:{type:"string"},
          parts:PLAN_PARTS_SCHEMA
        },
        required:["title","approach","parts"]
      }
    }
  },
  required:["plans"]
};

export default async function handler(req,res){
  cors(res);
  if(req.method==="OPTIONS")return res.status(204).end();
  if(req.method!=="POST")return res.status(405).json({error:"Méthode non autorisée."});
  const key=process.env.OPENAI_API_KEY;
  if(!key)return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});

  let ids=[];
  try{
    const b=req.body||{};
    if(b.ownerMode===true) requireOwner(req); else requirePremiumOrOwner(req,b);

    const p=b.project||b.projet||b;
    const s=txt(p.sujet||p.subject);
    if(!s)return res.status(400).json({error:"Le sujet est obligatoire."});

    const files=Array.isArray(p.files)?p.files:[];
    const count=Number(b.count)===1?1:3;
    const words=Math.max(640,clampPages(p)*WORDS_PER_PAGE);
    const docs=files.length?await buildProjectDocumentContext(files):{};
    ids=files.length?(assertFilesSize(files),await uploadProjectFiles(files,key)):[];

    const context=[
      "SUJET : "+s,
      "DOMAINE : "+(txt(p.domaine||p.domain)||"Non précisé"),
      "NIVEAU : "+(txt(p.niveau||p.level)||"Non précisé"),
      "TYPE : "+(txt(p.typeDoc||p.typeDocument||p.type)||"Non précisé"),
      "CONTEXTE : "+(txt(p.contexte||p.context)||"Aucun"),
      "CONSIGNES : "+(txt(p.consignes||p.instructions)||"Aucune"),
      "PROBLÉMATIQUE : "+JSON.stringify(b.problematic||b.problematique||p.problematiquePersonnelle||{}),
      "PLAN CLIENT : "+(txt(b.providedPlan||p.planPersonnel)||"Aucun"),
      buildDocumentInstructions(docs),
      "PRIORITÉ : contraintes explicites du client > guide méthodologique de ce projet > consignes du projet > problématique/plan > règles génériques Trimémo. Le guide reste strictement local à ce projet."
    ].join("\n\n");

    const system=[
      "Tu conçois les plans du projet courant.",
      "Lis et applique réellement les documents transmis.",
      "Le guide méthodologique est local à ce projet et prime sur les règles génériques lorsqu’il impose explicitement une autre architecture.",
      "Construis chaque plan à partir du sujet et de la problématique sélectionnée.",
      "Le nombre de parties, de chapitres, de sections et la profondeur de structure doivent découler du contenu réel.",
      "Lorsque trois plans sont demandés, ils doivent être réellement distincts sans sacrifier la cohérence scientifique.",
      "Ne retourne jamais trois architectures identiques ou symétriques.",
      "Ces contraintes font partie du contrat de sortie et seront contrôlées après génération.",
      "Si le guide méthodologique ou le plan client impose explicitement une autre structure, respecte cette contrainte locale.",
      "Si un PLAN CLIENT est fourni, le premier plan doit le reprendre fidèlement lorsque sa structure est compatible avec les contraintes locales ; les deux autres plans doivent proposer des alternatives réellement distinctes.",
      "N’invente aucun contexte absent.",
      "Toute numérotation est ajoutée par Trimémo après validation. Ne mets aucun numéro dans les titres.",
      "Retourne uniquement le JSON.",
      TRIMEMO_MASTER_ACADEMIC_RULES
    ].join("\n");

    const baseUser=context+"\n\nGénère exactement "+count+" plan(s). Volume indicatif : "+words+" mots. Respecte d’abord le guide et les consignes du projet. Ne transforme jamais le guide en règle globale.";

    let validatedPlans=null;
    let lastValidationReason="";

    for(let attempt=0;attempt<3;attempt++){
      const correction=attempt===0
        ? ""
        : "\n\nCONTRÔLE STRUCTUREL : la génération précédente a été rejetée : "+lastValidationReason+". Régénère les plans en corrigeant précisément ce défaut. Les titres doivent contenir uniquement leur contenu sémantique, sans numérotation.";

      const response=await fetch(OPENAI_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
        body:JSON.stringify({
          model:getOpenAIModel(),
          input:[
            {role:"system",content:[{type:"input_text",text:system}]},
            {role:"user",content:[{type:"input_text",text:baseUser+correction},...ids.map(file_id=>({type:"input_file",file_id}))]}
          ],
          text:{format:{type:"json_schema",name:"trimemo_academic_toc",strict:true,schema:SCHEMA}}
        })
      });

      const raw=await response.text();
      if(!response.ok){
        let detail=raw;
        try{const e=JSON.parse(raw);detail=e?.error?.message||detail}catch{}
        throw fail("Erreur OpenAI pendant la génération du plan : "+String(detail).slice(0,1200),502);
      }

      const data=json(out(JSON.parse(raw)));
      if(!Array.isArray(data?.plans)||data.plans.length<count){
        lastValidationReason="le nombre de plans retournés est insuffisant";
        continue;
      }

      const candidate=data.plans.slice(0,count);
      const validation=validatePlanSet(candidate,{requireDistinct:count>1,requireNaturalVariation:true});
      if(!validation.valid){
        lastValidationReason=validation.reason;
        continue;
      }

      validatedPlans=candidate.map((plan,i)=>normalizePlanStructure(plan,i,words));
      break;
    }

    if(!validatedPlans){
      throw fail("Les plans générés ne respectent pas les règles structurelles de Trimémo après trois tentatives : "+lastValidationReason,502);
    }

    await deleteOpenAIFiles(ids,key);
    ids=[];

    return res.status(200).json({plans:validatedPlans});
  }catch(e){
    await deleteOpenAIFiles(ids,key);
    console.error("generate-plans error",e);
    return res.status(e.status||500).json({error:e?.status&&e.status<500?e.message:"Une erreur interne est survenue pendant la génération des plans."});
  }
}
