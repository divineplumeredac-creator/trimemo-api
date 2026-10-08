import { getOpenAIModel } from "../lib/openai-model.js";
import { setCors } from "../lib/http.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles, deleteOpenAIFiles, extractFileText } from "../lib/project-documents.js";
import { clampPages, assertFilesSize } from "../lib/limits.js";
import { PLAN_PARTS_SCHEMA, normalizePlanStructure } from "../lib/plan-structure.js";
import { extractMethodologyContract, methodologyContractText, validateMethodologyStructure } from "../lib/methodology-contract.js";

const OPENAI_URL="https://api.openai.com/v1/responses";
const WORDS_PER_PAGE=320;

function cors(res,req){ setCors(res, req, "POST, OPTIONS"); }
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

async function callModel({key,system,user,schema,name,files=[],timeoutMs=45000}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetch(OPENAI_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
      body:JSON.stringify({
        model:getOpenAIModel(),
        input:[
          {role:"system",content:[{type:"input_text",text:system}]},
          {role:"user",content:[{type:"input_text",text:user},...files.map(file_id=>({type:"input_file",file_id}))]}
        ],
        max_output_tokens:12000,
        text:{format:{type:"json_schema",name,strict:true,schema}}
      })
    });
  }catch(e){
    if(e?.name==="AbortError") throw fail("Le service de génération a dépassé le délai interne. La génération est arrêtée pour éviter le timeout Vercel.",504);
    throw e;
  }finally{
    clearTimeout(timer);
  }
  const raw=await response.text();
  if(!response.ok){
    let detail=raw;
    try{const e=JSON.parse(raw);detail=e?.error?.message||detail}catch{}
    throw fail("Erreur OpenAI : "+String(detail).slice(0,1200),502);
  }
  return json(out(JSON.parse(raw)));
}

async function repairPlanSet({key,system,user,schema,name,files,plans,reason}) {
  const repairUser = user + "\n\nRÉPARATION OBLIGATOIRE :\nLa première génération a été rejetée par le validateur serveur.\nMotif : " + reason +
    "\nVoici la génération rejetée :\n" + JSON.stringify(plans) +
    "\nCorrige uniquement les défauts structurels. Conserve le sujet, la problématique, les consignes et la logique scientifique. Respecte exactement le schéma et toutes les contraintes numériques du contrat méthodologique local. Retourne exactement le nombre de plans demandé.";
  return callModel({key,system,user:repairUser,schema,name,files,timeoutMs:90000});
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
    const requestedPages=clampPages(p);
    const words=requestedPages*WORDS_PER_PAGE;
    const introductionPages=Math.max(1,Math.round(requestedPages*0.10));
    const conclusionPages=Math.max(1,Math.round(requestedPages*0.06));
    const bodyPages=Math.max(1,requestedPages-introductionPages-conclusionPages);
    const introductionWords=introductionPages*WORDS_PER_PAGE;
    const conclusionWords=conclusionPages*WORDS_PER_PAGE;
    const bodyWords=Math.max(0,words-introductionWords-conclusionWords);
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
      "NOMBRE DE PAGES DEMANDE : "+requestedPages,
      "VOLUME TOTAL CIBLE : "+words+" mots ("+requestedPages+" pages à "+WORDS_PER_PAGE+" mots/page)",
      "VOLUME RESERVE A L INTRODUCTION : "+introductionWords+" mots ("+introductionPages+" pages)",
      "VOLUME RESERVE A LA CONCLUSION : "+conclusionWords+" mots ("+conclusionPages+" pages)",
      "VOLUME DISPONIBLE POUR LE CORPS : "+bodyWords+" mots ("+bodyPages+" pages)",
      buildDocumentInstructions(docs)
    ].join("\n\n");

    // Seuls les fichiers explicitement identifiés comme méthodologie/instructions
    // peuvent imposer une structure. Les références générales ne deviennent jamais
    // automatiquement un contrat méthodologique.
    const methodologyDocs = Array.isArray(files)
      ? files.filter(file => {
          const category = String(file?.category || "").trim().toLowerCase();
          const name = String(file?.name || "").toLowerCase();
          return category === "methodology" || category === "instructions" || /(methodolog|méthodolog|guide|consigne|instruction|norme|format|jury)/i.test(name);
        })
      : [];

    // Certains navigateurs/projets arrivent avec un nom de fichier neutre
    // ou une catégorie "reference". On ne doit pas perdre un guide normatif
    // pour cette seule raison. On autorise donc une détection de secours
    // uniquement lorsque le contenu contient plusieurs marqueurs méthodologiques
    // forts. Cette détection reste locale au projet et ne crée aucune règle globale.
    const strongGuideMarkers = [
      /guide\s+m[ée]thodolog/i,
      /propositions?\s+de\s+probl[ée]matiques?\s+et\s+de\s+plans?/i,
      /ossature\s+exig[ée]e/i,
      /structure\s+(?:impos[ée]e|exig[ée]e)/i,
      /m[ée]moire\s+de\s+master/i,
      /chapitres?\s+et\s+parties?/i
    ];
    const looksLikeMethodologyGuide = (text) => {
      const value = String(text || "");
      const hits = strongGuideMarkers.reduce((n, re) => n + (re.test(value) ? 1 : 0), 0);
      return hits >= 2;
    };

    // La détection de secours se fait fichier par fichier.
    // Un document de référence ne devient jamais un guide simplement parce
    // qu'un autre document du dossier contient des marqueurs méthodologiques.
    const fallbackGuideFiles = [];
    if (Array.isArray(files)) {
      for (const file of files) {
        if (methodologyDocs.includes(file)) continue;
        try {
          const text = await extractFileText(file);
          if (looksLikeMethodologyGuide(text)) {
            fallbackGuideFiles.push({ file, text: String(text || "").trim() });
          }
        } catch (e) {
          console.warn("methodology fallback extraction failed", file?.name, e?.message || e);
        }
      }
    }

    const methodologyContext = methodologyDocs.length ? await buildProjectDocumentContext(methodologyDocs) : {};
    const classifiedGuideText = [
      methodologyContext?.methodologyText,
      methodologyContext?.instructionsText
    ].map(v => String(v || "").trim()).filter(Boolean).join("\n\n").trim();
    const fallbackGuideText = fallbackGuideFiles.map(({file,text}) =>
      "DOCUMENT : "+(file?.name || "guide méthodologique")+"\n"+text
    ).join("\n\n");
    const detectedGuideText = [classifiedGuideText, fallbackGuideText].filter(Boolean).join("\n\n").trim();
    const methodologyContract=extractMethodologyContract(detectedGuideText);
    const guideRules=detectedGuideText
      ? methodologyContractText(methodologyContract)+"\n\nTEXTE INTÉGRAL DU GUIDE MÉTHODOLOGIQUE :\n"+detectedGuideText.trim()
      : methodologyContractText(methodologyContract);

    const contract={
      researchType:txt(p.typeDoc||p.typeDocument||p.type)||"Travail académique",
      documentType:txt(p.typeDoc||p.typeDocument||p.type)||"Mémoire",
      academicLevel:txt(p.niveau||p.level)||"Non précisé",
      discipline:txt(p.domaine||p.domain)||"Non précisée",
      methodology:txt(p.methodologie||p.methodology)||"Selon les consignes et documents fournis",
      mandatoryStructure:txt(p.structure||p.structureObligatoire)||"Structure académique adaptée au sujet",
      mandatoryRequirements:[txt(p.consignes||p.instructions),guideRules].filter(Boolean),
      clientConstraints:[txt(p.contexte||p.context)].filter(Boolean),
      contextConstraints:[],
      scientificDimensions:[],
      requiredChain:[],
      prohibitedAssumptions:["Ne rien inventer : terrain, données, institution, population ou méthode."],
      personalPlan:txt(p.planPersonnel),
      personalProblematic:txt(p.problematiquePersonnelle)
    };

    const methodologyAuthority = detectedGuideText
      ? `DOCUMENTS MÉTHODOLOGIQUES DU CLIENT — AUTORITÉ SUPÉRIEURE POUR CE PROJET UNIQUEMENT :
Les documents ci-dessous sont les consignes méthodologiques du client.
Tu dois les lire intégralement avant de construire le plan.
Leurs exigences explicites priment sur toute règle générale de Trimémo.
Aucune règle générique de structure, de nombre de parties, de chapitres, de sections,
de sous-sections, de méthode, de présentation ou de raisonnement ne peut les remplacer.
Si une règle générale de Trimémo entre en conflit avec une exigence explicite du guide,
applique le guide du client.
Cette priorité est locale à ce projet et ne doit jamais devenir une règle générale pour les autres projets.

TEXTE INTÉGRAL DES DOCUMENTS MÉTHODOLOGIQUES :
${detectedGuideText}`
      : "AUCUN DOCUMENT MÉTHODOLOGIQUE CLIENT DÉTECTÉ.";

    const generationSystem=`Tu es Trimémo Academic Engine.
Tu dois produire un plan de recherche scientifique et analytique, pas un plan d'exposé.

${methodologyAuthority}

ORDRE DE PRIORITÉ DES INSTRUCTIONS :
PRIORITÉ 1 : documents méthodologiques du client.
PRIORITÉ 2 : autres consignes explicites du client.
PRIORITÉ 3 : problématique, plan personnel et contexte fournis.
PRIORITÉ 4 : règles générales de Trimémo.

CONTRAINTE ABSOLUE : aucune règle générale du moteur ne doit écraser une exigence explicite du client ou de son guide.
Chaque exigence obligatoire doit être prise en compte dans la structure.
Aucune règle générale du moteur ne doit écraser une exigence explicite du client ou une instruction contenue dans un document normatif joint.
Tu dois raisonner à partir de la problématique, des dimensions scientifiques et de la méthodologie.
Les titres doivent exprimer des objets scientifiques, mécanismes, relations, déterminants, processus, effets, tensions ou analyses.
Évite les titres génériques tels que "généralités", "importance", "enjeux", "avantages et inconvénients", "solutions" lorsqu'ils ne correspondent pas à une véritable démonstration.

Une partie ne doit pas être une simple catégorie thématique.
Le nombre de pages demandé est une contrainte de volume obligatoire.\nLe document entier doit rester autour du volume cible calculé.\nLe corps dispose du volume restant après les réserves de l introduction et de la conclusion.\nRépartis ce volume entre les chapitres selon leur importance scientifique.\nLe nombre de sections et de sous-sections doit rester proportionné au volume disponible.\nNe multiplie pas artificiellement les niveaux de structure.\nChaque partie doit jouer une fonction dans la démonstration.
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

    const structureTargets=count>1
      ?[
        "PLAN 1 : produire une architecture scientifiquement cohérente avec les exigences du projet.",
        "PLAN 2 : proposer une logique argumentative réellement distincte, tout en respectant exactement les contraintes méthodologiques du projet.",
        "PLAN 3 : proposer une troisième architecture scientifiquement distincte, sans modifier les exigences imposées par le client."
      ].slice(0,count)
      :["PLAN UNIQUE : choisir l'architecture la plus pertinente selon le sujet, la problématique et les exigences du projet."];

    const baseUser = [
      contractText(contract),
      "DOSSIER CLIENT COMPLET:",
      context,
      "Génère exactement "+count+" plan(s). Volume indicatif : "+words+" mots.",
      "Chaque plan doit expliciter une approche scientifique distincte dans le champ approach.",
      "CONTRAINTE DE VOLUME : "+requestedPages+" pages visées, soit "+words+" mots au total.",
      "Répartition indicative : introduction "+introductionPages+" pages, corps "+bodyPages+" pages, conclusion "+conclusionPages+" pages.",
      "Les chapitres doivent se partager les "+bodyWords+" mots du corps. Ne crée pas une architecture dont la rédaction normale dépasserait ce budget.",
      "ARCHITECTURES STRUCTURELLES OBLIGATOIRES:",
      ...structureTargets.map(item => "- "+item),
      "ORDRE DE PRIORITÉ FINAL : guide méthodologique client > autres instructions client > problématique/plan/contexte client > règles générales Trimémo.",
      "Le guide méthodologique doit être traité comme la spécification contractuelle de ce projet. Ne l'interprète pas comme un simple document de référence.",
      "Ne remplace jamais une exigence explicite du guide par une architecture standard de Trimémo. Si le guide impose une structure différente, respecte exactement celle du guide.",
      "Les différences entre plans doivent porter sur la logique scientifique, sans modifier aucune contrainte imposée par le guide. Les contraintes numériques détectées dans le contrat sont obligatoires."
    ].join("\n\n");

    const defaultPartMin=2, defaultPartMax=3;
    const defaultChapterMin=2, defaultChapterMax=3;
    const requiredPartMin=methodologyContract.partCount||defaultPartMin;
    const requiredPartMax=methodologyContract.partCount||defaultPartMax;
    const requiredChapterMin=methodologyContract.chaptersPerPart||defaultChapterMin;
    const requiredChapterMax=methodologyContract.chaptersPerPart||defaultChapterMax;
    // Construire explicitement tout le sous-schema imbrique.
    // OpenAI Responses API exige un type sur chaque niveau de properties.
    const schema={
      type:"object",
      additionalProperties:false,
      properties:{
        plans:{
          type:"array",
          minItems:count,
          maxItems:count,
          items:{
            type:"object",
            additionalProperties:false,
            properties:{
              title:{type:"string"},
              approach:{type:"string"},
              parts:{
                type:"array",
                minItems:requiredPartMin,
                maxItems:requiredPartMax,
                items:{
                  type:"object",
                  additionalProperties:false,
                  properties:{
                    title:{type:"string"},
                    description:{type:"string"},
                    chapters:{
                      type:"array",
                      minItems:requiredChapterMin,
                      maxItems:requiredChapterMax,
                      items:{
                        type:"object",
                        additionalProperties:false,
                        properties:{
                          title:{type:"string"},
                          description:{type:"string"},
                          wordCount:{type:"integer"},
                          sections:{
                            type:"array",
                            minItems:2,
                            maxItems:3,
                            items:{
                              type:"object",
                              additionalProperties:false,
                              properties:{
                                title:{type:"string"},
                                description:{type:"string"},
                                subsections:{
                                  type:"array",
                                  maxItems:8,
                                  items:{
                                    type:"object",
                                    additionalProperties:false,
                                    properties:{
                                      title:{type:"string"},
                                      description:{type:"string"},
                                      internalTitles:{
                                        type:"array",
                                        maxItems:8,
                                        items:{
                                          type:"object",
                                          additionalProperties:false,
                                          properties:{title:{type:"string"}},
                                          required:["title"]
                                        }
                                      }
                                    },
                                    required:["title","description","internalTitles"]
                                  }
                                }
                              },
                              required:["title","description","subsections"]
                            }
                          }
                        },
                        required:["title","description","wordCount","sections"]
                      }
                    }
                  },
                  required:["title","description","chapters"]
                }
              }
            },
            required:["title","approach","parts"]
          }
        }
      },
      required:["plans"]
    };

    // Les contraintes structurelles du guide sont injectées directement dans le JSON Schema.
    // Le modèle ne peut donc plus retourner un nombre de parties ou de chapitres incompatible.
    let data=await callModel({
      key,
      system:generationSystem,
      user:baseUser,
      schema,
      name:"trimemo_academic_toc",
      files:ids,
      timeoutMs:120000
    });

    const validateGeneratedPlans = (plans) => {
      if(!Array.isArray(plans) || plans.length !== count){
        return {valid:false,reason:"OpenAI doit retourner exactement "+count+" plan(s), mais en a retourné "+(Array.isArray(plans)?plans.length:0)+"."};
      }
      for(let i=0;i<count;i++){
        const plan=plans[i];
        const guideCheck=validateMethodologyStructure(plan,methodologyContract);
        if(!guideCheck.valid) return {valid:false,reason:"Plan "+(i+1)+" : "+guideCheck.reason};
        const parts=Array.isArray(plan?.parts)?plan.parts:[];
        if(parts.length<requiredPartMin || parts.length>requiredPartMax)
          return {valid:false,reason:"Plan "+(i+1)+" : nombre de parties hors contrat."};
        for(let pi=0;pi<parts.length;pi++){
          const chapters=Array.isArray(parts[pi]?.chapters)?parts[pi].chapters:[];
          if(chapters.length<requiredChapterMin || chapters.length>requiredChapterMax)
            return {valid:false,reason:"Plan "+(i+1)+" : la partie "+(pi+1)+" ne respecte pas le nombre de chapitres attendu."};
          for(let ci=0;ci<chapters.length;ci++){
            const sections=Array.isArray(chapters[ci]?.sections)?chapters[ci].sections:[];
            if(sections.length<2 || sections.length>3)
              return {valid:false,reason:"Plan "+(i+1)+" : le chapitre "+(ci+1)+" doit comporter 2 ou 3 sections."};
          }
        }
      }
      return {valid:true,reason:""};
    };

    let validation=validateGeneratedPlans(data?.plans);
    if(!validation.valid){
      data=await repairPlanSet({
        key,
        system:generationSystem,
        user:baseUser,
        schema,
        name:"trimemo_academic_toc_repair",
        files:ids,
        plans:data?.plans || [],
        reason:validation.reason
      });
      validation=validateGeneratedPlans(data?.plans);
      if(!validation.valid){
        throw fail("La génération reste incompatible avec le contrat méthodologique après réparation : "+validation.reason,422);
      }
    }

    const validatedPlans=data.plans.slice(0,count).map((plan,i)=>normalizePlanStructure(plan,i,words));

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
    const status=Number.isInteger(e?.status)?e.status:500;
    return res.status(status).json({
      error:e?.message||"Une erreur est survenue pendant la génération des plans.",
      code:e?.code||"PLAN_GENERATION_ERROR"
    });
  }
}