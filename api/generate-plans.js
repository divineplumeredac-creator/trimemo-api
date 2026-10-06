import { getOpenAIModel } from "../lib/openai-model.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles, deleteOpenAIFiles } from "../lib/project-documents.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";

const OPENAI_URL="https://api.openai.com/v1/responses", WORDS_PER_PAGE=320;
function cors(res){res.setHeader("Access-Control-Allow-Origin",String(process.env.TRIMEMO_FRONTEND_URL || ""));res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");}
function fail(m,s=400){const e=new Error(m);e.status=s;return e}
function txt(v){return String(v??"").trim()}
function out(d){if(d?.output_text?.trim())return d.output_text.trim();const t=(d?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text).join("").trim();if(!t)throw fail("OpenAI n’a retourné aucun plan exploitable.",502);return t}
function json(v){try{return JSON.parse(v)}catch{const a=v.indexOf("{"),b=v.lastIndexOf("}");if(a>=0&&b>a)return JSON.parse(v.slice(a,b+1));throw fail("Réponse OpenAI invalide.",502)}}
function title(v,k,f){const p={part:/^part(?:ie)?\s+(?:[IVXLCDM]+|\d+)\s*[.\-–—:]?\s*/i,chapter:/^chap(?:itre|ter)?\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,section:/^section\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,subsection:/^sous[- ]section\s+\d+(?:\.\d+)*\s*[.\-–—:]?\s*/i};return txt(v).replace(p[k],"").trim()||f}
const internal={type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"}},required:["title"]}};
const subs={type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},internalTitles:internal},required:["title","internalTitles"]}};
const sections={type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},subsections:subs},required:["title","subsections"]}};
const chapters={type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},sections},required:["title","sections"]}};
const parts={type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},chapters},required:["title","chapters"]}};
const SCHEMA={type:"object",additionalProperties:false,properties:{plans:{type:"array",items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},approach:{type:"string"},parts},required:["title","approach","parts"]}}},required:["plans"]};

function normalize(raw, i, words) {
  const ps = Array.isArray(raw?.parts) ? raw.parts : [];
  if (!ps.length) throw fail("Plan sans partie.", 502);
  const base = `plan-${i + 1}`;
  const P = ps.map((p, pi) => {
    const cs = Array.isArray(p?.chapters) ? p.chapters : [];
    if (!cs.length) throw fail("Partie vide.", 502);
    const partId = `${base}-part-${pi + 1}`;
    return {
      id: partId, number: pi + 1, title: title(p.title, "part", "Partie " + (pi + 1)), description: "",
      chapters: cs.map((c, ci) => {
        const ss = Array.isArray(c?.sections) ? c.sections : [];
        if (!ss.length) throw fail("Chapitre vide.", 502);
        const chapterId = `${partId}-chapter-${ci + 1}`;
        return {
          id: chapterId, number: ci + 1, title: title(c.title, "chapter", "Chapitre " + (ci + 1)), description: "", wordCount: 0,
          sections: ss.map((s, si) => {
            const sectionId = `${chapterId}-section-${si + 1}`;
            const subs = Array.isArray(s?.subsections) ? s.subsections : [];
            return {
              id: sectionId, number: si + 1, title: title(s.title, "section", "Section " + (si + 1)), description: "",
              subsections: subs.map((u, ui) => {
                const subId = `${sectionId}-sub-${ui + 1}`;
                const its = Array.isArray(u?.internalTitles) ? u.internalTitles : [];
                return {
                  id: subId, number: ui + 1, title: title(u?.title, "subsection", "Sous-section " + (ui + 1)), description: "",
                  internalTitles: its.map((x, xi) => ({ id: `${subId}-internal-${xi + 1}`, number: xi + 1, title: txt(x?.title) || "Titre interne " + (xi + 1) })),
                };
              }),
            };
          }),
        };
      }),
    };
  });
  const all = P.flatMap((x) => x.chapters), base2 = Math.floor(words / Math.max(1, all.length));
  let r = words - base2 * all.length;
  for (const p of P) for (const c of p.chapters) c.wordCount = base2 + (r-- > 0 ? 1 : 0);
  const intro = Math.max(300, Math.round(words * 0.1)), con = Math.min(700, Math.max(250, Math.round(words * 0.06)));
  return {
    id: "plan-" + (i + 1), title: txt(raw.title) || "Plan " + (i + 1), description: "",
    approach: txt(raw.approach) || "Structure adaptée au projet", totalWords: words,
    introductionGeneral: { title: "Introduction générale", description: "", wordCount: intro },
    parts: P,
    conclusionGeneral: { title: "Conclusion générale", description: "", wordCount: con },
    introduction: { title: "Introduction générale", description: "", wordCount: intro },
    conclusion: { title: "Conclusion générale", description: "", wordCount: con },
  };
}

export default async function handler(req,res){
 cors(res);if(req.method==="OPTIONS")return res.status(204).end();if(req.method!=="POST")return res.status(405).json({error:"Méthode non autorisée."});
 const key=process.env.OPENAI_API_KEY;if(!key)return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});
 let ids=[];
 try{
  const b=req.body||{};if(b.ownerMode===true)requireOwner(req);else requirePremiumOrOwner(req,b);
  const p=b.project||b.projet||b,s=txt(p.sujet||p.subject);if(!s)return res.status(400).json({error:"Le sujet est obligatoire."});
  const files=Array.isArray(p.files)?p.files:[];const count=Number(b.count)===1?1:3,words=Math.max(640,clampPages(p)*WORDS_PER_PAGE),docs=files.length?await buildProjectDocumentContext(files):{};ids=files.length?(assertFilesSize(files),await uploadProjectFiles(files,key)):[];
  const context=["SUJET : "+s,"DOMAINE : "+(txt(p.domaine||p.domain)||"Non précisé"),"NIVEAU : "+(txt(p.niveau||p.level)||"Non précisé"),"TYPE : "+(txt(p.typeDoc||p.typeDocument||p.type)||"Non précisé"),"CONTEXTE : "+(txt(p.contexte||p.context)||"Aucun"),"CONSIGNES : "+(txt(p.consignes||p.instructions)||"Aucune"),"PROBLÉMATIQUE : "+JSON.stringify(b.problematic||b.problematique||p.problematiquePersonnelle||{}),"PLAN CLIENT : "+(txt(b.providedPlan||p.planPersonnel)||"Aucun"),buildDocumentInstructions(docs),"PRIORITÉ : contraintes explicites du client > guide méthodologique de ce projet > consignes du projet > problématique/plan > règles génériques Trimémo. Le guide reste strictement local à ce projet."].join("\n\n");
  const system=["Tu conçois les plans du projet courant.","Lis et applique réellement les documents transmis.","Le guide méthodologique est local à ce projet et prime sur les règles génériques lorsqu’il impose explicitement une autre architecture.","Construis chaque plan à partir du sujet et de la problématique sélectionnée.
Le nombre de parties, de chapitres, de sections et la profondeur de structure doivent découler du contenu réel.
Lorsque trois plans sont demandés, ils doivent être réellement distincts sans sacrifier la cohérence scientifique.","Les trois plans doivent donc être structurellement différents. Ne retourne jamais trois architectures identiques ou symétriques.","Ces contraintes font partie du contrat de sortie et doivent être respectées pendant la génération, pas corrigées après coup.","Si le guide méthodologique ou le plan client impose explicitement une autre structure, respecte cette contrainte locale.","Si un PLAN CLIENT est fourni, le premier plan doit le reprendre fidèlement lorsque sa structure est compatible avec les contraintes locales ; les deux autres plans doivent proposer des alternatives réellement distinctes.","N’invente aucun contexte absent.","Retourne uniquement le JSON.",TRIMEMO_MASTER_ACADEMIC_RULES].join("\n");
  const user=context+"\n\nGénère exactement "+count+" plan(s). Volume indicatif : "+words+" mots. Respecte d’abord le guide et les consignes du projet. Ne transforme jamais le guide en règle globale.";
  const r=await fetch(OPENAI_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({model:getOpenAIModel(),input:[{role:"system",content:[{type:"input_text",text:system}]},{role:"user",content:[{type:"input_text",text:user},...ids.map(file_id=>({type:"input_file",file_id}))]}],text:{format:{type:"json_schema",name:"trimemo_academic_toc",strict:true,schema:SCHEMA}}})});
  const raw=await r.text();if(!r.ok){let detail=raw;try{const e=JSON.parse(raw);detail=e?.error?.message||detail}catch{}throw fail("Erreur OpenAI pendant la génération du plan : "+String(detail).slice(0,1200),502);}
  const data=json(out(JSON.parse(raw)));
  await deleteOpenAIFiles(ids, key);
  ids=[];
  if(!Array.isArray(data?.plans)||data.plans.length<count)throw fail("OpenAI n’a pas retourné le nombre de plans demandé.",502);
  return res.status(200).json({plans:data.plans.slice(0,count).map((x,i)=>normalize(x,i,words)).map((x,i)=>{x.id="plan-"+(i+1);return x;})});
 }catch(e){await deleteOpenAIFiles(ids,key);console.error("generate-plans error",e);return res.status(e.status||500).json({error:e?.status && e.status < 500 ? e.message : "Une erreur interne est survenue pendant la génération des plans."});}
}
