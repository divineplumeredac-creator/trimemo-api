function clean(v){return String(v??"").replace(/\s+/g," ").trim()}
function numberFromFrench(v){
  const map={un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8};
  const s=String(v??"").toLowerCase().trim();
  return /^\d+$/.test(s)?Number(s):map[s]||null;
}

function headingLines(text,kind){
  const re=kind==="part"
    ? /^\s*(?:PARTIE|PART)\s+(?:[IVXLCDM]+|\d+)\s*[.\-:]?\s*(.+)$/gim
    : /^\s*(?:CHAPITRE|CHAPTER)\s+(?:[IVXLCDM]+|\d+(?:\.\d+)?)\s*[.\-:]?\s*(.+)$/gim;
  const out=[];let m;
  while((m=re.exec(text))&&out.length<30)out.push(clean(m[1]));
  return out;
}

function normativeSentences(text){
  return String(text||"")
    .replace(/\r/g," ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map(clean)
    .filter(Boolean)
    .filter(s=>/\b(?:exig[ée]e?s?|impos[ée]e?s?|obligatoire?s?|doit|doivent|devra|devront|ossature)\b/i.test(s));
}

function countInSentence(sentence,kind){
  const noun=kind==="part"?"(?:grandes\s+)?part(?:ie|ies)":"chapitr(?:e|es)";
  const re=new RegExp("\\b(deux|trois|quatre|cinq|six|sept|huit|\\d+)\\s+"+noun+"\\b","i");
  const m=String(sentence||"").match(re);
  return m?numberFromFrench(m[1]):null;
}

export function extractMethodologyContract(text){
  const raw=String(text||"").trim();
  if(!raw)return {hasGuide:false};

  const firstProposal=raw.split(/\b(?:Proposition|Plan|Proposition de plan)\s+(?:n[°º]?\s*)?2\b/i)[0];
  const firstParts=headingLines(firstProposal,"part");
  const firstChapters=headingLines(firstProposal,"chapter");
  const sentences=normativeSentences(raw);

  let partCount=null;
  let chapterCount=null;
  let evidence="";
  for(const sentence of sentences){
    const p=countInSentence(sentence,"part");
    const c=countInSentence(sentence,"chapter");
    if(p||c){
      if(p)partCount=p;
      if(c)chapterCount=c;
      evidence=sentence;
      if(p&&c)break;
    }
  }

  // Les intitulés du premier modèle servent uniquement de repli lorsqu'un passage
  // normatif confirme qu'une ossature est exigée. Ils ne sont jamais interprétés
  // comme une obligation simplement parce qu'ils existent dans un exemple.
  const normativeEvidence=Boolean(evidence);
  if(normativeEvidence){
    if(!partCount&&firstParts.length)partCount=firstParts.length;
    if(!chapterCount&&firstChapters.length)chapterCount=firstChapters.length;
  }

  const requiredHierarchy={
    introduction:/\bintroduction\s+générale\b/i.test(raw),
    sections:/\bsection\s+\d/i.test(raw),
    subsections:/\b(?:sous[- ]section|\d+\.\d+\.\d+)\b/i.test(raw),
    conclusion:/\bconclusion\s+générale\b/i.test(raw),
    bibliography:/\bbibliographie\b/i.test(raw),
    annexes:/\bannexes?\b/i.test(raw)
  };

  const chaptersPerPart=partCount&&chapterCount&&chapterCount%partCount===0
    ? chapterCount/partCount
    : null;

  // Le guide peut contenir une contrainte normative sur le nombre de sections.
  // On ne la déduit jamais d'un simple exemple de plan.
  let sectionsPerChapter=null;
  let sectionEvidence="";
  for(const sentence of sentences){
    const m=String(sentence||"").match(/\b(deux|trois|quatre|cinq|six|sept|huit|\d+)\s+sections?\b/i);
    if(m){
      sectionsPerChapter=numberFromFrench(m[1]);
      sectionEvidence=sentence;
      break;
    }
  }

  return {
    hasGuide:true,
    partCount,
    chapterCount,
    chaptersPerPart,
    sectionsPerChapter,
    sectionEvidence,
    hasExplicitStructure:normativeEvidence,
    evidence,
    requiredHierarchy,
    blueprintParts:firstParts,
    blueprintChapters:firstChapters,
    instructionText:raw
  };
}

export function methodologyContractText(c){
  if(!c?.hasGuide)return "Aucun guide méthodologique local détecté.";
  const h=Object.entries(c.requiredHierarchy).filter(([,v])=>v).map(([k])=>k).join(", ")||"aucune";
  const lines=[
    "CONTRAT MÉTHODOLOGIQUE LOCAL, OBLIGATOIRE POUR CE PROJET UNIQUEMENT :",
    c.partCount?"Nombre de parties imposé par le guide : "+c.partCount+".":"",
    c.chapterCount?"Nombre total de chapitres imposé par le guide : "+c.chapterCount+".":"",
    c.chaptersPerPart?"Répartition imposée : "+c.chaptersPerPart+" chapitre(s) par partie.":"",
    c.sectionsPerChapter?"Nombre de sections imposé par chapitre : "+c.sectionsPerChapter+".":"",
    c.sectionEvidence?"Preuve normative pour les sections : "+c.sectionEvidence:"",
    c.evidence?"Preuve normative extraite du guide : "+c.evidence:"",
    "Hiérarchie détectée dans le document : "+h+".",
    c.blueprintParts?.length?"Architecture du premier modèle du guide, utilisée comme référence fonctionnelle :\n"+c.blueprintParts.map((x,i)=>"Partie "+(i+1)+" : "+x).join("\n"):"",
    c.blueprintChapters?.length?"Chapitres du premier modèle :\n"+c.blueprintChapters.map((x,i)=>"Chapitre "+(i+1)+" : "+x).join("\n"):"",
    "Les intitulés de référence servent à comprendre la fonction méthodologique attendue. Ils ne doivent pas être copiés mécaniquement si le sujet impose des adaptations.",
    "Ce contrat est local au projet et ne devient jamais une règle générale de Trimémo."
  ];
  return lines.filter(Boolean).join("\n\n");
}

export function validateMethodologyStructure(plan,c){
  if(!c?.hasGuide)return {valid:true,reason:""};
  const parts=Array.isArray(plan?.parts)?plan.parts:[];
  if(c.partCount&&parts.length!==c.partCount)
    return {valid:false,reason:"Le guide méthodologique impose "+c.partCount+" partie(s), mais le plan en contient "+parts.length+"."};
  const chapters=parts.flatMap(p=>Array.isArray(p?.chapters)?p.chapters:[]);
  if(c.chapterCount&&chapters.length!==c.chapterCount)
    return {valid:false,reason:"Le guide méthodologique impose "+c.chapterCount+" chapitre(s), mais le plan en contient "+chapters.length+"."};
  if(c.chaptersPerPart){
    for(let i=0;i<parts.length;i++){
      const n=Array.isArray(parts[i]?.chapters)?parts[i].chapters.length:0;
      if(n!==c.chaptersPerPart)
        return {valid:false,reason:"Le guide méthodologique impose "+c.chaptersPerPart+" chapitre(s) dans chaque partie ; la partie "+(i+1)+" en contient "+n+"."};
    }
  }
  if(c.sectionsPerChapter){
    for(let pi=0;pi<parts.length;pi++){
      const chapters=Array.isArray(parts[pi]?.chapters)?parts[pi].chapters:[];
      for(let ci=0;ci<chapters.length;ci++){
        const n=Array.isArray(chapters[ci]?.sections)?chapters[ci].sections.length:0;
        if(n!==c.sectionsPerChapter)
          return {valid:false,reason:"Le guide méthodologique impose "+c.sectionsPerChapter+" section(s) par chapitre ; le chapitre "+(ci+1)+" de la partie "+(pi+1)+" en contient "+n+"."};
      }
    }
  }
  return {valid:true,reason:""};
}