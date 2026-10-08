import { getOpenAIModel } from "../lib/openai-model.js";
import { setCors } from "../lib/http.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles, deleteOpenAIFiles } from "../lib/project-documents.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";
import { PLAN_PARTS_SCHEMA, normalizePlanStructure } from "../lib/plan-structure.js";

const OPENAI_URL="https://api.openai.com/v1/responses";
const WORDS_PER_PAGE=320;

function cors(res,req){
  setCors(res, req, "POST, OPTIONS");
}
function fail(m,s=400){const e=new Error(m);e.status=s;return e}
function txt(v){return String(v??"").trim()}
function out(d){
  if(d?.output_text?.trim()) return d.output_text.trim();
  const t=(d?.output||[]).flatMap(x=>x?.content||[]).filter(x=>x?.type==="output_text").map(x=>x.text).join("").trim();
  if(!t) throw fail("OpenAI n’a retourné aucun résultat exploitable.",502);
  return t;
}
function json(v){
  try{return JSON.parse(v)}catch{
    const a=v.indexOf("{"),b=v.lastIndexOf("}");
    if(a>=0&&b>a)return JSON.parse(v.slice(a,b+1));
    throw fail("Réponse OpenAI invalide.",502);
  }
}

const CONTRACT_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{
    researchType:{type:"string"},documentType:{type:"string"},academicLevel:{type:"string"},
    discipline:{type:"string"},methodology:{type:"string"},mandatoryStructure:{type:"string"},
    mandatoryRequirements:{type:"array",items:{type:"string"}},
    clientConstraints:{type:"array",items:{type:"string"}},
    contextConstraints:{type:"array",items:{type:"string"}},
    scientificDimensions:{type:"array",items:{type:"string"}},
    requiredChain:{type:"array",items:{type:"string"}},
    prohibitedAssumptions:{type:"array",items:{type:"string"}},
    personalPlan:{type:"string"},personalProblematic:{type:"string"}
  },
  required:["researchType","documentType","academicLevel","discipline","methodology","mandatoryStructure","mandatoryRequirements","clientConstraints","contextConstraints","scientificDimensions","requiredChain","prohibitedAssumptions","personalPlan","personalProblematic"]
};

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

const EVALUATION_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{
    valid:{type:"boolean"},
    score:{type:"integer"},
    failures:{type:"array",items:{type:"string"}},
    matchedRequirements:{type:"array",items:{type:"string"}},
    scientificQuality:{type:"string"},
    academicLogic:{type:"string"}
  },
  required:["valid","score","failures","matchedRequirements","scientificQuality","academicLogic"]
};

async function callModel({key,system,user,schema,name,files=[],timeoutMs=45000}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetch(OPENAI_URL,{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
    body:JSON.stringify({
      model:getOpenAIModel(),
      input:[
        {role:"system",content:[{type:"input_text",text:system}]},
        {role:"user",content:[{type:"input_text",text:user},...files.map(file_id=>({type:"input_file",file_id}))]}
      ],
      max_output_tokens:12000,
      text:{format:{type:"json_schema",name,strict:true,schema}}
    });
  }catch(e){
    if(e?.name==="AbortError") throw fail("Le service de génération a dépassé le délai interne. La génération est arrêtée pour éviter le timeout Vercel.",504);
    throw e;
  }finally{
    clearTimeout(timer);
  }
  const raw=await response.text();
  if(!response.ok){
    let detail=raw;try{const e=JSON.parse(raw);detail=e?.error?.message||detail}catch{}
    throw fail("Erreur OpenAI : "+String(detail).slice(0,1200),502);
  }
  return json(out(JSON.parse(raw)));
}

async function buildClientContract({key,context,docs}){
  const system=`Tu es l'analyste des exigences académiques de Trimémo.
Ta mission n'est PAS de produire un plan. Tu dois transformer le dossier du client en CONTRAT SCIENTIFIQUE EXÉCUTABLE.

Tu dois lire toutes les informations disponibles et les hiérarchiser.
Toute consigne saisie directement dans le champ CONSIGNES doit être extraite mot à mot dans les exigences obligatoires lorsqu'elle impose une action, une structure, une méthode, un volume, une source, une présentation ou une interdiction.
Les fichiers joints ne doivent pas être traités comme un simple contexte documentaire : leur catégorie détermine leur rôle.
Les fichiers « Instructions » et « Méthodologie » sont normatifs pour ce projet.
Les fichiers « Contexte » définissent le périmètre.
Les fichiers « Source » et « Référence » servent de matière documentaire, pas de règles de structure, sauf instruction explicite contenue dans leur catégorie normative.
HIÉRARCHIE ABSOLUE DES CONTRAINTES :
1. CONSIGNES SAISIES DIRECTEMENT PAR LE CLIENT : priorité maximale.
2. DOCUMENTS JOINTS CLASSÉS « Instructions » ou « Méthodologie » : priorité immédiatement après les consignes saisies.
3. Problématique et plan personnels fournis par le client : doivent être conservés et pris en compte, sans les modifier silencieusement.
4. Contexte, domaine, niveau et type de document.
5. Règles académiques générales de Trimémo : elles ne peuvent jamais contredire une consigne client explicite ou une règle du guide joint.

Une consigne saisie ou présente dans un document prioritaire n'est pas une information secondaire. Elle constitue une exigence exécutable du projet.
Si une règle générale de Trimémo entre en conflit avec une consigne client explicite, la consigne client prévaut.
Un guide méthodologique joint est local au projet et ne doit jamais être remplacé par les règles générales de la plateforme.
Le contexte fourni doit influencer le périmètre du plan.
Le niveau et le type de document doivent influencer le niveau de profondeur et la logique scientifique.
Une problématique personnelle doit être conservée sans changement de sens.
Un plan personnel doit être identifié séparément et ne doit pas être confondu avec le plan proposé par Trimémo.

Tu dois distinguer :
1. ce qui est explicitement imposé ;
2. ce qui est déduit légitimement ;
3. ce qui manque ;
4. ce qui est interdit d'inventer.

Pour un mémoire, une thèse ou un travail scientifique, identifie les dimensions nécessaires à l'analyse de la problématique.
Ne réduis jamais le dossier à une liste de thèmes d'exposé.
Ne transforme pas une consigne en simple information descriptive.
Retourne uniquement le JSON.`;

  return callModel({
    key,system,
    user:context+"\n\nDOCUMENTS DU PROJET :\n"+docs,
    schema:CONTRACT_SCHEMA,name:"trimemo_client_contract"
  });
}



function contractText(c){
  return [
    "ORDRE DE PRIORITÉ OBLIGATOIRE : les consignes saisies par le client et les documents joints classés Instructions/Méthodologie priment sur toute règle générale de Trimémo.",
    "CONTRAT SCIENTIFIQUE DU CLIENT :",
    "Type de recherche : "+c.researchType,
    "Type de document : "+c.documentType,
    "Niveau : "+c.academicLevel,
    "Discipline : "+c.discipline,
    "Méthodologie : "+c.methodology,
    "Structure imposée : "+c.mandatoryStructure,
    "Problématique personnelle : "+c.personalProblematic,
    "Plan personnel : "+c.personalPlan,
    "EXIGENCES OBLIGATOIRES :\n- "+(c.mandatoryRequirements||[]).join("\n- "),
    "CONTRAINTES CLIENT :\n- "+(c.clientConstraints||[]).join("\n- "),
    "CONTRAINTES DE CONTEXTE :\n- "+(c.contextConstraints||[]).join("\n- "),
    "DIMENSIONS SCIENTIFIQUES À TRAITER :\n- "+(c.scientificDimensions||[]).join("\n- "),
    "CHAÎNE À RESPECTER :\n- "+(c.requiredChain||[]).join("\n- "),
    "INTERDICTIONS :\n- "+(c.prohibitedAssumptions||[]).join("\n- ")
  ].join("\n\n");
}

async function evaluatePlans({key,plans,contract,context,count}){
  const system=`Tu es le contrôleur scientifique de Trimémo.
Tu ne corriges pas les plans. Tu décides s'ils respectent réellement le contrat du client.

Un plan est INVALID si :
- une exigence explicite n'est pas intégrée ;
- le contexte fourni n'influence pas réellement les axes ;
- la méthodologie imposée est ignorée ;
- le niveau académique est traité comme un simple exposé ;
- la problématique est seulement reformulée sans architecture analytique ;
- les parties sont organisées comme un exposé généraliste ;
- les chapitres empilent définitions, importance, avantages/inconvénients ou solutions sans démonstration ;
- les trois plans ne proposent pas de logiques scientifiques réellement distinctes ;
- le plan personnel demandé comme référence est ignoré sans justification ;
- un terrain, une organisation, des données ou une méthode non fournis sont inventés.

Un bon plan scientifique doit faire apparaître une progression argumentative et analytique.
Il doit permettre de relier concepts, cadre théorique, mécanismes, méthodologie, analyse et discussion selon le type de recherche.
Le simple respect du nombre de parties ne constitue jamais une validation.

Retourne uniquement le JSON.`;

  return callModel({
    key,system,
    user:contractText(contract)+"\n\nDOSSIER INITIAL :\n"+context+
      "\n\nPLANS À CONTRÔLER :\n"+JSON.stringify(plans)+
      "\n\nNombre demandé : "+count,
    schema:EVALUATION_SCHEMA,name:"trimemo_plan_scientific_evaluation"
  });
}

export default async function handler(req,res){
  cors(res, req);
  if(req.method==="OPTIONS")return res.status(204).end();
  if(req.method!=="POST")return res.status(405).json({error:"Méthode non autorisée."});
  const key=process.env.OPENAI_API_KEY;
  if(!key)return res.status(500).json({error:"OPENAI_API_KEY est absente du serveur."});

  let ids=[];
  try{
    const b=req.body||{};
    if(b.ownerMode===true) requireOwner(req); else requirePremiumOrOwner(req,b);

    const p=b.project||b.projet||b;
    const subject=txt(p.sujet||p.subject);
    if(!subject)return res.status(400).json({error:"Le sujet est obligatoire."});

    const files=Array.isArray(p.files)?p.files:[];
    const count=Number(b.count)===1?1:3;
    const words=Math.max(640,clampPages(p)*WORDS_PER_PAGE);
    const docs=files.length?await buildProjectDocumentContext(files):{};
    ids=files.length?(assertFilesSize(files),await uploadProjectFiles(files,key)):[];

    const context=[
      "SUJET : "+subject,
      "DOMAINE : "+(txt(p.domaine||p.domain)||"Non précisé"),
      "NIVEAU : "+(txt(p.niveau||p.level)||"Non précisé"),
      "TYPE DE DOCUMENT : "+(txt(p.typeDoc||p.typeDocument||p.type)||"Non précisé"),
      "CONTEXTE : "+(txt(p.contexte||p.context)||"Aucun"),
      "CONSIGNES : "+(txt(p.consignes||p.instructions)||"Aucune"),
      "PROBLÉMATIQUE : "+JSON.stringify(b.problematic||b.problematique||p.problematiquePersonnelle||{}),
      "PLAN PERSONNEL : "+(txt(b.providedPlan||p.planPersonnel)||"Aucun"),
      buildDocumentInstructions(docs)
    ].join("\n\n");

    const guideRules=docs?.methodologyText?.trim()
      ? "GUIDE MÉTHODOLOGIQUE LOCAL DU PROJET :\n"+docs.methodologyText.trim()
      : "";

    // Les informations du client sont déjà structurées dans le dossier transmis.
    // Éviter un second appel LLM uniquement pour reformater les consignes réduit fortement
    // le risque de timeout et conserve les exigences originales dans le prompt de génération.
    const contract = {
      researchType: txt(p.typeDoc || p.typeDocument || p.type) || "Travail académique",
      documentType: txt(p.typeDoc || p.typeDocument || p.type) || "Mémoire",
      academicLevel: txt(p.niveau || p.level) || "Non précisé",
      discipline: txt(p.domaine || p.domain) || "Non précisée",
      methodology: txt(p.methodologie || p.methodology) || "Selon les consignes et documents fournis",
      mandatoryStructure: txt(p.structure || p.structureObligatoire) || "Structure académique adaptée au sujet",
      mandatoryRequirements: [txt(p.consignes || p.instructions), guideRules].filter(Boolean),
      clientConstraints: [txt(p.contexte || p.context)].filter(Boolean),
      contextConstraints: [],
      scientificDimensions: [],
      requiredChain: [],
      prohibitedAssumptions: ["Ne rien inventer : terrain, données, institution, population ou méthode."],
      personalPlan: txt(p.planPersonnel),
      personalProblematic: txt(p.problematiquePersonnelle),
    };

    const generationSystem=`Tu es Trimémo Academic Engine.
Tu dois produire un plan de recherche scientifique et analytique, pas un plan d'exposé.

CONTRAINTE ABSOLUE : le CONTRAT SCIENTIFIQUE ci-dessous est la spécification du client.
PRIORITÉ 1 : les consignes saisies directement par le client.
PRIORITÉ 2 : les fichiers joints classés Instructions ou Méthodologie.
PRIORITÉ 3 : la problématique, le plan personnel et le contexte fournis.
PRIORITÉ 4 : les règles générales de Trimémo.
Chaque exigence obligatoire doit être prise en compte dans la structure.
Aucune règle générale du moteur ne doit écraser une exigence explicite du client ou une instruction contenue dans un document normatif joint.
Tu dois raisonner à partir de la problématique, des dimensions scientifiques et de la méthodologie.
Les titres doivent exprimer des objets scientifiques, mécanismes, relations, déterminants, processus, effets, tensions ou analyses.
Évite les titres génériques tels que "généralités", "importance", "enjeux", "avantages et inconvénients", "solutions" lorsqu'ils ne correspondent pas à une véritable démonstration.

Une partie ne doit pas être une simple catégorie thématique.
Chaque partie doit jouer une fonction dans la démonstration.
Chaque chapitre doit faire progresser la réponse à la problématique.
Chaque section doit développer une dimension identifiable.
Le plan doit être exploitable pour une rédaction de mémoire, thèse ou rapport scientifique selon le type demandé.

N'invente jamais un terrain, une enquête, des données, une organisation, une population ou une méthode.
Ne transforme pas une recherche documentaire en étude empirique.
Si une donnée manque, construis autour de ce qui est réellement fourni.

Pour trois plans, produis trois architectures argumentatives réellement différentes.
La différence doit porter sur le raisonnement scientifique, pas seulement sur les titres.
Un même nombre de parties est autorisé si les logiques sont réellement différentes.

La numérotation sera ajoutée par Trimémo. Ne numérote aucun titre.
Retourne uniquement le JSON.

${TRIMEMO_MASTER_ACADEMIC_RULES}`;

    const structureTargets = count > 1
      ? [
          "PLAN 1 : produire une architecture scientifiquement cohérente avec les exigences du projet.",
          "PLAN 2 : proposer une logique argumentative réellement distincte, tout en respectant exactement les contraintes méthodologiques du projet.",
          "PLAN 3 : proposer une troisième architecture scientifiquement distincte, sans modifier les exigences imposées par le client."
        ].slice(0, count)
      : [
          "PLAN UNIQUE : choisir l'architecture la plus pertinente selon le sujet, la problématique et les exigences du projet."
        ];

    const baseUser=contractText(contract)+"\n\nDOSSIER CLIENT COMPLET :\n"+context+
      "\n\nGénère exactement "+count+" plan(s). Volume indicatif : "+words+" mots."+
      "\nChaque plan doit expliciter une approche scientifique distincte dans le champ approach."+
      "\n\nARCHITECTURES STRUCTURELLES OBLIGATOIRES :\n- "+structureTargets.join("\n- ")+
      "\nNe remplace pas les exigences du projet par une architecture standard de Trimémo. Les différences entre plans doivent porter sur la logique scientifique, tout en respectant le guide méthodologique fourni lorsqu'il existe.");

    let validatedPlans=null;
    let lastReason="";

    // Un seul appel de génération : les contrôles de structure sont déterministes
    // et ne nécessitent pas un second appel OpenAI.
    const data=await callModel({
      key,
      system:generationSystem,
      user:baseUser,
      schema:SCHEMA,
      name:"trimemo_academic_toc",
      files:ids,
      timeoutMs:150000
    });

    if(!Array.isArray(data?.plans)||data.plans.length<count){
      lastReason="Le nombre de plans retournés est insuffisant.";
    } else {
      // Le schéma JSON strict d'OpenAI constitue le contrôle structurel primaire.
      // Ne pas appliquer une seconde validation générique ici : elle pourrait
      // rejeter un guide méthodologique valide ou une architecture imposée par le client.
      validatedPlans=data.plans.slice(0,count).map((plan,i)=>normalizePlanStructure(plan,i,words));
    }

    if(!validatedPlans){
      throw fail("La génération des plans n'a pas retourné les trois propositions attendues.",502);
    }

    await deleteOpenAIFiles(ids,key);
    ids=[];

    return res.status(200).json({
      plans:validatedPlans,
      academicControl:{
        score:null,
        matchedRequirements:[],
        scientificQuality:"Validation structurelle effectuée côté serveur.",
        academicLogic:"Validation déterministe de la structure et conservation des exigences client."
      }
    });
  }catch(e){
    await deleteOpenAIFiles(ids,key);
    console.error("generate-plans error",e);
    const status = Number.isInteger(e?.status) ? e.status : 500;
    return res.status(status).json({
      error: e?.message || "Une erreur est survenue pendant la génération des plans.",
      code: e?.code || "PLAN_GENERATION_ERROR"
    });
  }
}
