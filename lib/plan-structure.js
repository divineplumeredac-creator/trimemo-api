/**
 * Trimémo shared plan structure validator.
 * Public and admin plan generation both pass through this module.
 */

function text(v) {
  return String(v ?? "").trim();
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function cleanStructuralTitle(value, kind, fallback = "") {
  let title = text(value);
  if (!title) return fallback;
  const labels = {
    part: /^(?:partie|part)\s+(?:[IVXLCDM]+|\d+)\s*[.\-–—:]?\s*/i,
    chapter: /^(?:chapitre|chapter)\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,
    section: /^section\s+\d+(?:\.\d+)*\s*[.\-–—:]?\s*/i,
    subsection: /^(?:sous[- ]section|subsection)\s+\d+(?:\.\d+)*\s*[.\-–—:]?\s*/i,
  };
  title = title.replace(labels[kind], "");
  title = title.replace(/^§\s*/, "");
  title = title.replace(/^(?:\d+\.){1,6}\s*/, "");
  title = title.replace(/^[IVXLCDM]+\s*[.\-–—:]\s*/i, "");
  return title.trim() || fallback;
}

export function structuralSignature(plan) {
  const parts = asArray(plan?.parts);
  const chapterCounts = parts.map(p => asArray(p?.chapters).length);
  const sectionCounts = parts.flatMap(p => asArray(p?.chapters).map(c => asArray(c?.sections).length));
  const subsectionCounts = parts.flatMap(p =>
    asArray(p?.chapters).flatMap(c => asArray(c?.sections).map(s => asArray(s?.subsections).length))
  );
  return [parts.length, chapterCounts.join(","), sectionCounts.join(","), subsectionCounts.join(",")].join("|");
}

export function validatePlanStructure(plan, options = {}) {
  const { requireNaturalVariation = false, label = "Plan" } = options;
  const parts = asArray(plan?.parts);
  if (parts.length < 2 || parts.length > 3) return { valid:false, reason:`${label} doit comporter 2 ou 3 parties.` };

  for (let pi = 0; pi < parts.length; pi++) {
    const chapters = asArray(parts[pi]?.chapters);
    if (chapters.length < 2 || chapters.length > 3) return { valid:false, reason:`${label} : la partie ${pi+1} doit comporter 2 ou 3 chapitres.` };
    for (let ci = 0; ci < chapters.length; ci++) {
      const sections = asArray(chapters[ci]?.sections);
      if (sections.length < 2 || sections.length > 3) return { valid:false, reason:`${label} : le chapitre ${ci+1} de la partie ${pi+1} doit comporter 2 ou 3 sections.` };
      for (const section of sections) {
        const subs = asArray(section?.subsections);
        if (subs.length > 3) return { valid:false, reason:`${label} : une section comporte plus de 3 sous-sections.` };
        for (const sub of subs) {
          if (asArray(sub?.internalTitles).length > 3) return { valid:false, reason:`${label} : une sous-section comporte plus de 3 titres internes.` };
        }
      }
    }
  }

  if (requireNaturalVariation) {
    const chapterCounts = parts.map(p => asArray(p?.chapters).length);
    const sectionCounts = parts.flatMap(p => asArray(p?.chapters).map(c => asArray(c?.sections).length));
    const subsectionCounts = parts.flatMap(p => asArray(p?.chapters).flatMap(c => asArray(c?.sections).map(s => asArray(s?.subsections).length)));
    if (new Set(chapterCounts).size === 1 && new Set(sectionCounts).size === 1 && new Set(subsectionCounts).size === 1) {
      return { valid:false, reason:`${label} présente une architecture parfaitement symétrique. La structure doit suivre la matière et varier lorsque le contenu le justifie.` };
    }
  }
  return { valid:true, reason:"" };
}

export function normalizePlanStructure(raw, index = 0, words = 0) {
  const parts = asArray(raw?.parts);
  const base = `plan-${index+1}`;
  let globalChapter = 0;
  const normalizedParts = parts.map((part, pi) => {
    const partId = `${base}-part-${pi+1}`;
    const chapters = asArray(part?.chapters).map((chapter, ci) => {
      globalChapter++;
      const chapterId = `${partId}-chapter-${ci+1}`;
      const sections = asArray(chapter?.sections).map((section, si) => {
        const sectionId = `${chapterId}-section-${si+1}`;
        const subsections = asArray(section?.subsections).map((sub, ui) => {
          const subId = `${sectionId}-sub-${ui+1}`;
          return {
            id: subId, number: ui+1,
            title: cleanStructuralTitle(sub?.title, "subsection", `Sous-section ${ui+1}`),
            description: text(sub?.description),
            internalTitles: asArray(sub?.internalTitles).map((item, xi) => ({
              id:`${subId}-internal-${xi+1}`, number:xi+1,
              title: cleanStructuralTitle(item?.title, "subsection", `Titre interne ${xi+1}`)
            }))
          };
        });
        return { id:sectionId, number:si+1, title:cleanStructuralTitle(section?.title,"section",`Section ${si+1}`), description:text(section?.description), subsections };
      });
      return { id:chapterId, number:globalChapter, title:cleanStructuralTitle(chapter?.title,"chapter",`Chapitre ${globalChapter}`), description:text(chapter?.description), wordCount:Number(chapter?.wordCount||0), sections };
    });
    return { id:partId, number:pi+1, title:cleanStructuralTitle(part?.title,"part",`Partie ${pi+1}`), description:text(part?.description), chapters };
  });
  const chapters = normalizedParts.flatMap(p=>p.chapters);
  const safeWords = Math.max(0,Number(words)||0);
  const baseWords = chapters.length ? Math.floor(safeWords/chapters.length) : 0;
  let remainder = chapters.length ? safeWords-baseWords*chapters.length : 0;
  for (const chapter of chapters) chapter.wordCount = baseWords + (remainder-- > 0 ? 1 : 0);
  const intro = Math.max(300,Math.round(safeWords*0.10));
  const conclusion = Math.min(700,Math.max(250,Math.round(safeWords*0.06)));
  return {
    id:`plan-${index+1}`, title:text(raw?.title)||`Plan ${index+1}`, description:text(raw?.description),
    approach:text(raw?.approach)||"Structure adaptée au projet", totalWords:safeWords, parts:normalizedParts,
    introductionGeneral:{title:"Introduction générale",description:"",wordCount:intro},
    conclusionGeneral:{title:"Conclusion générale",description:"",wordCount:conclusion},
    introduction:{title:"Introduction générale",description:"",wordCount:intro},
    conclusion:{title:"Conclusion générale",description:"",wordCount:conclusion}
  };
}

function semanticPlanSignature(plan) {
  const raw = [
    text(plan?.title),
    text(plan?.approach),
    ...asArray(plan?.parts).flatMap(part => [
      text(part?.title),
      text(part?.description),
      ...asArray(part?.chapters).flatMap(chapter => [
        text(chapter?.title),
        text(chapter?.description),
        ...asArray(chapter?.sections).flatMap(section => [
          text(section?.title),
          text(section?.description),
          ...asArray(section?.subsections).flatMap(sub => [
            text(sub?.title),
            text(sub?.description),
            ...asArray(sub?.internalTitles).map(item => text(item?.title))
          ])
        ])
      ])
    ])
  ].join(" ");

  return new Set(
    raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-z0-9\\s]/g, " ")
      .split(/\\s+/)
      .filter(word => word.length > 2)
  );
}

function semanticSimilarity(a, b) {
  const A = semanticPlanSignature(a);
  const B = semanticPlanSignature(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const word of A) if (B.has(word)) intersection++;
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

export function validatePlanSet(plans, options = {}) {
  const list = asArray(plans);
  for (let i=0;i<list.length;i++) {
    const result=validatePlanStructure(list[i],{
      requireNaturalVariation:options.requireNaturalVariation!==false,
      label:`Plan ${i+1}`
    });
    if(!result.valid) return result;
  }

  // La diversité des plans ne doit jamais bloquer une génération valide.
  // Une même ossature peut être imposée par un guide méthodologique.
  // On rejette uniquement les doublons quasi exacts.
  if(options.requireDistinct===true && list.length>1) {
    const fingerprints=list.map(plan =>
      JSON.stringify({
        title:text(plan?.title).toLowerCase().replace(/\\s+/g," "),
        approach:text(plan?.approach).toLowerCase().replace(/\\s+/g," "),
        parts:asArray(plan?.parts).map(part=>({
          title:text(part?.title).toLowerCase().replace(/\\s+/g," "),
          chapters:asArray(part?.chapters).map(ch=>({
            title:text(ch?.title).toLowerCase().replace(/\\s+/g," "),
            sections:asArray(ch?.sections).map(section=>text(section?.title).toLowerCase().replace(/\\s+/g," "))
          }))
        }))
      })
    );
    if(new Set(fingerprints).size!==fingerprints.length){
      return {
        valid:false,
        reason:"Deux plans retournés sont des doublons exacts. Une nouvelle proposition est nécessaire."
      };
    }
  }

  return {valid:true,reason:""};
}

export const PLAN_PARTS_SCHEMA = {
  type:"array",minItems:2,maxItems:3,
  items:{type:"object",additionalProperties:false,properties:{
    title:{type:"string"},description:{type:"string"},
    chapters:{type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{
      title:{type:"string"},description:{type:"string"},wordCount:{type:"integer"},
      sections:{type:"array",minItems:2,maxItems:3,items:{type:"object",additionalProperties:false,properties:{
        title:{type:"string"},description:{type:"string"},
        subsections:{type:"array",maxItems:3,items:{type:"object",additionalProperties:false,properties:{
          title:{type:"string"},description:{type:"string"},
          internalTitles:{type:"array",maxItems:3,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"}},required:["title"]}}
        },required:["title","description","internalTitles"]}}
      },required:["title","description","subsections"]}}
    },required:["title","description","wordCount","sections"]}}
  },required:["title","description","chapters"]}
};
