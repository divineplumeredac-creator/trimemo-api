function clean(v){return String(v??"").replace(/\s+/g," ").trim()}
function numberFromFrench(v){const map={un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8};const s=String(v).toLowerCase();return /^\d+$/.test(s)?Number(s):map[s]||null}
function explicitCount(text, kind){
  const noun = kind === "part" ? "(?:grandes\\s+)?part(?:ie|ies)" : "chapitr(?:e|es)";
  const patterns = [
    new RegExp("\\b(?:soit|comprend|comporte|prévoit|exige|doit comporter|doit comprendre|est composé de|est composée de)\\s+(deux|trois|quatre|cinq|six|sept|huit|\\d+)\\s+"+noun+"\\b","i"),
    new RegExp("\\b(deux|trois|quatre|cinq|six|sept|huit|\\d+)\\s+"+noun+"\\s+(?:obligatoires?|imposées?|imposés?|exigées?|exigés?)\\b","i")
  ];
  for(const re of patterns){
    const m=text.match(re);
    if(m){
      const map={un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8};
      const s=String(m[1]).toLowerCase();
      const n=/^\\d+$/.test(s)?Number(s):map[s]||null;
      if(n)return n;
    }
  }
  return null;
}
function headingLines(text,kind){
  const re=kind==="part"
    ? /^\\s*(?:PARTIE|PART)\\s+(?:[IVXLCDM]+|\\d+)\\s*[.\\-:]?\\s*(.+)$/gim
    : /^\\s*(?:CHAPITRE|CHAPTER)\\s+(?:[IVXLCDM]+|\\d+(?:\\.\\d+)?)\\s*[.\\-:]?\\s*(.+)$/gim;
  const out=[];let m;
  while((m=re.exec(text))&&out.length<30)out.push(clean(m[1]));
  return out;
}
function hasExplicitStructureLanguage(text){
  return /\\b(?:structure|plan)\\s+(?:impos[ée]|obligatoire|exig[ée])\\b|\\b(?:doit|devra|doivent|devront)\\s+(?:comporter|comprendre|respecter)\\b|\\b(?:soit|comprend|comporte|prévoit|exige)\\b/i.test(text);
}
export function extractMethodologyContract(text){
 const raw=String(text||"").trim(); if(!raw)return {hasGuide:false};
 const partCount=explicitCount(raw,"part");
 const chapterCount=explicitCount(raw,"chapter");
 const parts=headingLines(raw,"part"), chapters=headingLines(raw,"chapter");
 const explicit=hasExplicitStructureLanguage(raw);
 const detectedPartCount=partCount || (explicit && parts.length ? parts.length : null);
 const detectedChapterCount=chapterCount || (explicit && chapters.length ? chapters.length : null);
 const firstProposal=raw.split(/\\bProposition\\s+2\\b/i)[0];
 const blueprintParts=headingLines(firstProposal,"part");
 const blueprintChapters=headingLines(firstProposal,"chapter");
 const requiredHierarchy={introduction:/\\bintroduction\\s+générale\\b/i.test(raw),sections:/\\bsection\\s+\\d/i.test(raw),subsections:/\\b(?:sous[- ]section|\\d+\\.\\d+\\.\\d+)\\b/i.test(raw),conclusion:/\\bconclusion\\s+générale\\b/i.test(raw),bibliography:/\\bbibliographie\\b/i.test(raw),annexes:/\\bannexes?\\b/i.test(raw)};
 const chaptersPerPart=detectedPartCount&&detectedChapterCount&&detectedChapterCount%detectedPartCount===0?detectedChapterCount/detectedPartCount:null;
 return {hasGuide:true,partCount:detectedPartCount,chapterCount:detectedChapterCount,chaptersPerPart,hasExplicitStructure:explicit,requiredHierarchy,blueprintParts:blueprintParts.length?blueprintParts:parts,blueprintChapters:blueprintChapters.length?blueprintChapters:chapters,instructionText:raw};
}
export function methodologyContractText(c){if(!c?.hasGuide)return "Aucun guide méthodologique local détecté.";const h=Object.entries(c.requiredHierarchy).filter(([,v])=>v).map(([k])=>k).join(", ")||"aucune";const lines=["CONTRAT MÉTHODOLOGIQUE LOCAL, OBLIGATOIRE POUR CE PROJET UNIQUEMENT :",c.partCount?"Nombre de parties imposé par le guide : "+c.partCount+".":"",c.chapterCount?"Nombre total de chapitres imposé par le guide : "+c.chapterCount+".":"",c.chaptersPerPart?"Répartition imposée : "+c.chaptersPerPart+" chapitre(s) par partie.":"", "Hiérarchie explicitement détectée : "+h+".",c.blueprintParts?.length?"Architecture de référence extraite du guide :\n"+c.blueprintParts.map((x,i)=>"Partie "+(i+1)+" : "+x).join("\n"):"",c.blueprintChapters?.length?"Chapitres de référence extraits du guide :\n"+c.blueprintChapters.map((x,i)=>"Chapitre "+(i+1)+" : "+x).join("\n"):"","Les intitulés de référence servent à comprendre la fonction méthodologique attendue. Ils ne doivent pas être copiés mécaniquement si le sujet impose des adaptations.","Ce contrat est local au projet et ne devient jamais une règle générale de Trimémo."];return lines.filter(Boolean).join("\n\n")}
export function validateMethodologyStructure(plan,c){if(!c?.hasGuide)return {valid:true,reason:""};const parts=Array.isArray(plan?.parts)?plan.parts:[];if(c.partCount&&parts.length!==c.partCount)return {valid:false,reason:"Le guide méthodologique impose "+c.partCount+" partie(s), mais le plan en contient "+parts.length+"."};const chapters=parts.flatMap(p=>Array.isArray(p?.chapters)?p.chapters:[]);if(c.chapterCount&&chapters.length!==c.chapterCount)return {valid:false,reason:"Le guide méthodologique impose "+c.chapterCount+" chapitre(s), mais le plan en contient "+chapters.length+"."};if(c.chaptersPerPart){for(let i=0;i<parts.length;i++){const n=Array.isArray(parts[i]?.chapters)?parts[i].chapters.length:0;if(n!==c.chaptersPerPart)return {valid:false,reason:"Le guide méthodologique impose "+c.chaptersPerPart+" chapitre(s) dans chaque partie ; la partie "+(i+1)+" en contient "+n+"."}}}return {valid:true,reason:""}}