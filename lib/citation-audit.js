function folded(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function authorAliases(source) {
  const author = String(source?.author || source?.authors || source?.auteur || source?.organization || source?.organisation || "");
  const aliases = new Set((author.match(/[\p{Lu}][\p{L}\p{M}'’-]*/gu) || []).map(folded).filter(Boolean));
  for (const acronym of author.match(/\b[\p{Lu}]{2,}\b/gu) || []) aliases.add(folded(acronym));
  const key = folded(author);
  const authorWords = author.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) || [];
  if (authorWords.length) aliases.add(folded(authorWords.at(-1)));
  const lastWord = key.split(/\s+/u).at(-1);
  if (lastWord && !['et', 'al', 'the', 'de', 'du', 'des', 'd', 'la', 'le', 'les'].includes(lastWord)) aliases.add(lastWord);
  if (key.includes("organisation internationale du travail") || key === "oit") aliases.add("oit");
  if (key.includes("organisation de cooperation et de developpement economiques") || key === "ocde") aliases.add("ocde");
  if (key.includes("organisation des nations unies pour l alimentation et l agriculture")) aliases.add("fao");
  if (key.includes("fonds des nations unies pour l enfance")) aliases.add("unicef");
  return aliases;
}

function citationReferences(blocks, sources) {
  const known = new Set();
  for (const source of sources) {
    const year = folded(source?.year || source?.date || "s. d.").replace(/\s+/g, "");
    for (const alias of authorAliases(source)) known.add(alias + "|" + year);
  }

  const citations = new Map();
  const record = (authorText, yearText) => {
    const year = folded(yearText).replace(/\s+/g, "");
    const words = (String(authorText || "").match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) || [])
      .map(folded)
      .filter((word) => !["et", "al", "and", "amp"].includes(word));
    const acronym = String(authorText || "").match(/\[([\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*)\]\s*$/u);
    const surname = acronym ? folded(acronym[1]) : words.at(-1);
    if (!surname || !year) return;
    citations.set(surname + "|" + year, { surname, year });
  };

  const parentheticalYear = /\(([^()\n]{1,200})\)/gu;
  const narrativeYear = /([\p{Lu}][\p{L}\p{M}'’-]*(?:[\s,&]+(?:[\p{Lu}][\p{L}\p{M}'’-]*|et|al\.))*)\s*\(((?:19|20)\d{2}[a-z]?|s\.\s*d\.)\)/giu;
  for (const block of blocks) {
    const text = String(block?.content || "");
    for (const match of text.matchAll(parentheticalYear)) {
      const body = match[1];
      for (const part of body.split(/\s*;\s*/u)) {
        const yearMatch = part.match(/((?:19|20)\d{2}[a-z]?|s\.\s*d\.)/iu);
        if (yearMatch) record(part.slice(0, yearMatch.index), yearMatch[1]);
      }
    }
    for (const match of text.matchAll(narrativeYear)) record(match[1], match[2]);
  }

  return [...citations.values()].filter((citation) => !known.has(citation.surname + "|" + citation.year));
}

export function auditCitationReferences(blocks = [], sources = []) {
  const unmatched = citationReferences(
    Array.isArray(blocks) ? blocks : [],
    Array.isArray(sources) ? sources : [],
  );
  return {
    unmatched,
    count: unmatched.length,
  };
}

export default auditCitationReferences;
