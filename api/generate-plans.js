import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles } from "../lib/project-documents.js";

const OPENAI_URL="https://api.openai.com/v1/responses", WORDS_PER_PAGE=320;
function cors(res){res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");}
function fail(m,s=400){const e=new Error(m);e.status=s;return e}
function txt(v){return String(v??"").trim()}
function out(d){if(d?.output_text?.trim())return d.output_text.trim();const t=(d?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text).join("").trim();if(!t)throw fail("OpenAI n’a retourné aucun plan exploitable.",502);return t}
function json(v){try{return JSON.parse(v)}catch{const a=v.indexOf("{"),b=v.lastIndexOf("}");if(a>=0&&b>a)return JSON.parse(v.slice(a,b+1));throw fail("Réponse OpenAI invalide.",502)}}
function title(v,k,f){const p={part:/^part(?:ie)?\s+(?:[IVXLCDM]+|\d+)\s*[.\-–—:]?\s*/i,chapter:/^chap(?:itre|ter)?\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,section:/^section\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,subsection:/^sous[- ]section\s+\d+(?:\.\d+)*\s*[.\-–—:]?\s*/i};return txt(v).replace(p[k],"").trim()||f}
const internal={type:"array",minItems:0,maxItems:4,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"}},required:["title"]}};
const subs={type:"array",minItems:0,maxItems:8,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},internalTitles:internal},required:["title","internalTitles"]}};
const sections={type:"array",minItems:1,maxItems:8,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},subsections:subs},required:["title","subsections"]}};
const chapters={type:"array",minItems:1,maxItems:8,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},sections},required:["title","sections"]}};
const parts={type:"array",minItems:1,maxItems:8,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},chapters},required:["title","chapters"]}};
const SCHEMA={type:"object",additionalProperties:false,properties:{plans:{type:"array",minItems:1,maxItems:3,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},approach:{type:"string"},parts},required:["title","approach","parts"]}}},required:["plans"]};

function normalize(raw,i,words){
 const ps=Array.isArray(raw?.parts)?raw.parts:[]; if(!ps.length)throw fail("Plan sans partie.",502);
 const P=ps.map((p,pi)=>{const cs=Array.isArray(p?.chapters)?p.chapters:[];if(!cs.length)throw fail("Partie vide.",502);
  return {id:`plan-${i+1}-part-${pi+1}`,number:pi+1,title:title(p.title,"part","Partie "+(pi+1)),description:"",
   chapters:cs.map((c,ci)=>{const ss=Array.isArray(c?.sections)?c.sections:[];if(!ss.length)throw fail("Chapitre vide.",502);
    return {id:`plan-${i+1}-part-${pi+1}-chapter-${ci+1}`,number:ci+1,title:title(c.title,"chapter","Chapitre "+(ci+1)),description:"",wordCount:0,
     sections:ss.map((s,si)=>({id:`plan-${i+1}-part-${pi+1}-chapter-${ci+1}-section-${si+1}`,number:si+1,title:title(s.title,"section","Section "+(si+1)),description:"",
      subsections:(Array.isArray(s?.subsections)?s.subsections:[]).map((u,ui)=>({id:`plan-${i+1}-part-${pi+1}-chapter-${ci+1}-section-${si+1}-sub-${ui+1}`,number:ui+1,title:title(u?.title,"subsection","Sous-section "+(ui+1)),description:"",internalTitles:(Array.isArray(u?.internalTitles)?u.internalTitles:[]).map((x,xi)=>({id:`internal-${i+1}-${pi+1}-${ci+1}-${si+1}-${ui+1}-${xi+1}`,number:xi+1,title:txt(x?.title)||"Titre interne "+(xi+1)})))}))}))}})
   }});
 });
 const all=P.flatMap(x=>x.chapters), base=Math.floor(words/Math.max(1,all.length));let r=words-base*all.length,n=0;
 for(const p of P)for(const c of p.chapters)c.wordCount=base+(r-->0?1:0);
 const intro=Math.max(300,Math.round(words*.1)),con=Math.min(700,Math.max(250,Math.round(words*.06)));
 return {id:"plan-"+(i+1),title:txt(raw.title)||"Plan "+(i+1),description:"",approach:txt(raw.approach)||"Structure adaptée au projet",totalWords:words,introductionGeneral:{title:"Introduction générale",description:"",wordCount:intro},parts:P,conclusionGeneral:{title:"Conclusion générale",description:"",wordCount:con},introduction:{title:"Introduction générale",description:"",wordCount:intro},conclusion:{title:"Conclusion générale",description:"",wordCount:con}};
}

export default async function handler(req,res){
 cors(res);if(req.method==="OPTIONS")return res.status(204).end();if(req.method!=="POST")return res.status(405).json({error:"Méthode non autorisée."});
 const key=process.env.OPENAI_API_KEY;if(!key)return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});
 try{
  const b=req.body||{};if(b.ownerMode===true)requireOwner(req);else if(!(b.freePreview===true&&Number(b.count||1)===1))requirePremiumOrOwner(req,b);
  const p=b.project||b.projet||b,s=txt(p.sujet||p.subject);if(!s)return res.status(400).json({error:"Le sujet est obligatoire."});
  const count=Number(b.count)===1?1:3,words=Math.max(640,(Number(p.pages)||30)*WORDS_PER_PAGE),docs=await buildProjectDocumentContext(p.files),ids=await uploadProjectFiles(p.files,key);
  const context=["SUJET : "+s,"DOMAINE : "+(txt(p.domaine||p.domain)||"Non précisé"),"NIVEAU : "+(txt(p.niveau||p.level)||"Non précisé"),"TYPE : "+(txt(p.typeDoc||p.typeDocument||p.type)||"Non précisé"),"CONTEXTE : "+(txt(p.contexte||p.context)||"Aucun"),"CONSIGNES : "+(txt(p.consignes||p.instructions)||"Aucune"),"PROBLÉMATIQUE : "+JSON.stringify(b.problematic||b.problematique||p.problematiquePersonnelle||{}),"PLAN CLIENT : "+(txt(b.providedPlan||p.planPersonnel)||"Aucun"),buildDocumentInstructions(docs),"PRIORITÉ : contraintes explicites du client > guide méthodologique de ce projet > consignes du projet > problématique/plan > règles génériques Trimémo. Le guide reste strictement local à ce projet."].join("\n\n");
  const system=["Tu conçois les plans du projet courant.","Lis et applique réellement les documents transmis.","Le guide méthodologique est local à ce projet et prime sur les règles génériques lorsqu’il impose une structure.","Ne force jamais une structure générique de 2 ou 3 parties si le guide en impose une autre.","Respecte les quantités de parties, chapitres, sections et sous-sections explicitement imposées.","Si une quantité n’est pas imposée, choisis-la selon le sujet et la logique scientifique.","Les trois plans doivent varier par logique scientifique, sans matrice artificielle.","N’invente aucun contexte absent.","Retourne uniquement le JSON.",TRIMEMO_MASTER_ACADEMIC_RULES].join("\n");
  const user=context+"\n\nGénère exactement "+count+" plan(s). Volume indicatif : "+words+" mots. Respecte d’abord le guide et les consignes du projet. Ne transforme jamais le guide en règle globale.";
  const r=await fetch(OPENAI_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({model:(process.env.OPENAI_MODEL && process.env.OPENAI_MODEL !== "gpt-5.6-luna" ? process.env.OPENAI_MODEL : "gpt-6-luna"),input:[{role:"system",content:[{type:"input_text",text:system}]},{role:"user",content:[{type:"input_text",text:user},...ids.map(file_id=>({type:"input_file",file_id}))]}],text:{format:{type:"json_schema",name:"trimemo_academic_toc",strict:true,schema:SCHEMA}}})});
  const raw=await r.text();if(!r.ok)throw fail("Erreur OpenAI pendant la génération du plan.",502);
  const data=json(out(JSON.parse(raw)));if(!Array.isArray(data?.plans)||data.plans.length<count)throw fail("OpenAI n’a pas retourné le nombre de plans demandé.",502);
  return res.status(200).json({plans:data.plans.slice(0,count).map((x,i)=>normalize(x,i,words)).map((x,i)=>{x.id="plan-"+(i+1);return x;})});
 }catch(e){console.error("generate-plans error",e);return res.status(e.status||500).json({error:e.message||"Erreur interne lors de la génération des plans."});}
}
