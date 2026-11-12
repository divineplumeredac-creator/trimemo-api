// Keep the complete prompt byte-for-byte; only expose stable cache boundaries.
export function cachedWritingPrompt(prompt, documentPrefix) {
 const text = String(prompt || "");
 const prefix = String(documentPrefix || "");
 if (!prefix || !text.startsWith(prefix)) return text;
 const marker = "\n\nBLOC À RÉDIGER :";
 const split = text.indexOf(marker, prefix.length);
 const stableEnd = split >= prefix.length ? split : prefix.length;
 const cached = text => ({type:"text",text,cache_control:{type:"ephemeral",ttl:"1h"}});
 return [
  cached(prefix),
  ...(stableEnd > prefix.length ? [cached(text.slice(prefix.length,stableEnd))] : []),
  ...(stableEnd < text.length ? [{type:"text",text:text.slice(stableEnd)}] : [])
 ];
}
export function needsWritingSearch({title,kind,targetWords,preceding,instructions}={}) {
 // Research remains available by default. Skip it only for structural prose
 // backed by verified references already present in the document.
 if (/(recherch|actualis|récent|recent|nouvell.{0,12}source|vérifi.{0,12}source)/iu.test(String(instructions||""))) return true;
 const sources=(Array.isArray(preceding)?preceding:[]).flatMap(b=>Array.isArray(b.sources)?b.sources:[]);
 const verified=new Set(sources.filter(s=>s?.verified===true&&(s.url||s.doi)).map(s=>String(s.doi||s.url)));
 const label=String(title||"").normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if (/^conclusion(?:\s+generale)?\s*[:.!?]?$/u.test(label.trim())&&verified.size>=10) return false;
 const opening=['part_intro','partie_intro','part-intro','partie-intro','chapter_intro','chapitre_intro','chapter-intro','chapitre-intro'].includes(String(kind||""));
 return !(opening&&Number(targetWords)>0&&Number(targetWords)<=200&&verified.size>=1);
}
