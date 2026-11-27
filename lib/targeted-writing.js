import { createHash } from 'node:crypto';
export const TARGETED_MODE = 'targeted_writing';
export const TARGETED_PARTS = ['Introduction générale','Problématique de recherche','Revue de littérature','Cadre conceptuel','Cadre théorique','Méthodologie de recherche','Analyse des résultats','Discussion des résultats','Recommandations','Conclusion générale','Chapitre personnalisé','Autre partie'];
export function targetedSpec(project={}) {
  if (project.writingMode !== TARGETED_MODE) return null;
  const selections = project.targetedParts;
  if (!Array.isArray(selections) || !selections.length || selections.length > TARGETED_PARTS.length || new Set(selections).size !== selections.length || selections.some(part=>!TARGETED_PARTS.includes(part))) throw Object.assign(new Error('Sélectionnez les parties à rédiger.'), {status:400});
  const pages = Number(project.pages);
  if (!Number.isInteger(pages) || pages < selections.length || pages > 300) throw Object.assign(new Error('Prévoyez au moins une page par partie sélectionnée.'), {status:400});
  const custom = String(project.targetedCustomTitle||'').trim();
  if (selections.some(part=>['Chapitre personnalisé','Autre partie'].includes(part)) && !custom) throw Object.assign(new Error('Précisez le titre de la partie personnalisée.'), {status:400});
  const evidence = String(project.targetedEvidence||'').trim();
  if (selections.some(part=>['Méthodologie de recherche','Analyse des résultats','Discussion des résultats','Recommandations','Conclusion générale'].includes(part)) && !evidence && !(project.files||[]).some(file=>['context','source'].includes(file.category))) throw Object.assign(new Error('Ajoutez les informations de recherche ou les documents nécessaires à cette partie. Aucun résultat ni méthode réalisée ne sera inventé.'), {status:400});
  const totalWords = pages * 300;
  const portions = selections.map((key,index)=>{
    const words = Math.floor(totalWords/selections.length)+(index===0?totalWords%selections.length:0);
    return {key,title:['Chapitre personnalisé','Autre partie'].includes(key)?custom:key,words,sectionCount:Math.max(1,Math.ceil(words/900))};
  });
  return {selections,custom,evidence,totalWords,portions};
}
export function targetedFingerprint(project={}) {
  if(project.writingMode!==TARGETED_MODE)return null;
  return {mode:TARGETED_MODE,parts:project.targetedParts,custom:String(project.targetedCustomTitle||'').trim(),evidence:String(project.targetedEvidence||'').trim()};
}
export function buildTargetedPlan(project, groups) {
  const spec = targetedSpec(project);
  if (!spec || !Array.isArray(groups) || groups.length!==spec.portions.length) throw Object.assign(new Error('La structure ciblée est incomplète.'),{status:422});
  const parts = spec.portions.map((portion,index)=>{
    const sections=groups[index]?.sections;
    if(!Array.isArray(sections)||sections.length!==portion.sectionCount||sections.some(s=>!String(s?.title||'').trim())) throw Object.assign(new Error('La structure de '+portion.title+' ne correspond pas au volume demandé.'),{status:422});
    const titles=sections.map(s=>String(s.title).trim());
    if(new Set(titles.map(t=>t.toLowerCase())).size!==titles.length)throw Object.assign(new Error('Titres redondants dans '+portion.title),{status:422});
    return {id:'target-part-'+(index+1),number:index+1,title:portion.title,description:'',chapters:[{id:'target-chapter-'+(index+1),number:index+1,title:portion.title,description:'',wordCount:portion.words,sections:titles.map((title,i)=>({id:'target-section-'+(index+1)+'-'+(i+1),number:i+1,title,description:'',subsections:[]}))}]};
  });
  const digest=createHash('sha256').update(JSON.stringify([project.projectId,spec,parts])).digest('hex').slice(0,24);
  const empty={title:'',description:'',wordCount:0};
  return {id:'target-plan-'+digest,targetedWriting:true,title:'Rédaction ciblée',description:'',approach:'',totalWords:spec.totalWords,introductionGeneral:empty,conclusionGeneral:empty,introduction:empty,conclusion:empty,parts};
}
