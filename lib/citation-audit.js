function folded(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sourceAuthors(source) {
  const raw = source?.author || source?.authors || source?.auteur ||
    source?.organization || source?.organisation || '';
  if (Array.isArray(raw)) {
    return raw.map((item) => typeof item === 'string'
      ? item
      : item?.family || item?.lastName || item?.name || '').filter(Boolean);
  }
  return [String(raw)].filter(Boolean);
}

function authorAliases(source) {
  const aliases = new Set();
  for (const author of sourceAuthors(source)) {
    const words = author.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) || [];
    for (const word of words) {
      const alias = folded(word);
      if (alias && !['et', 'al', 'and', 'amp', 'the'].includes(alias)) aliases.add(alias);
    }
    const whole = folded(author);
    if (whole) aliases.add(whole);
    if (whole.includes('organisation internationale du travail') || whole === 'oit') aliases.add('oit');
    if (whole.includes('organisation de cooperation et de developpement economiques') || whole === 'ocde') aliases.add('ocde');
  }
  return aliases;
}

function normalizedYear(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}|s\.\s*d\./iu);
  return match ? folded(match[0]).replace(/\s+/g, '') : '';
}

function sourceIdentifiers(source) {
  const ids = new Set();
  for (const value of [source?.sourceId, source?.source_id, source?.paperId, source?.paper_id, source?.id]) {
    const id = folded(value);
    if (id) ids.add(id);
  }
  const doi = String(source?.doi || '').trim()
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  if (doi) ids.add('doi:' + doi);
  const url = String(source?.url || source?.link || '').trim().replace(/\/$/, '').toLowerCase();
  if (url) ids.add(url);
  return ids;
}

function citationAuthorTokens(authorText) {
  return new Set(
    (String(authorText || '').match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) || [])
      .map(folded)
      .filter((word) => word && !['et', 'al', 'and', 'amp', 'see', 'voir'].includes(word))
  );
}

function extractCitations(blocks) {
  const citations = new Map();
  const record = (authorText, yearText) => {
    const year = normalizedYear(yearText);
    const tokens = citationAuthorTokens(authorText);
    if (!tokens.size || !year) return;
    const surname = [...tokens].at(-1);
    const key = [...tokens].sort().join('|') + '|' + year;
    if (!citations.has(key)) citations.set(key, { surname, authors: [...tokens], year });
  };

  const parentheticalYear = /\(([^()\n]{1,240})\)/gu;
  const narrativeYear = /([\p{Lu}][\p{L}\p{M}'’-]*(?:[\s,&]+(?:[\p{Lu}][\p{L}\p{M}'’-]*|et|al\.))*)\s*\(((?:19|20)\d{2}|s\.\s*d\.)\)/gu;
  for (const block of blocks) {
    const content = String(block?.content || '');
    for (const match of content.matchAll(parentheticalYear)) {
      const body = match[1];
      const yearMatch = body.match(/((?:19|20)\d{2}|s\.\s*d\.)/u);
      if (!yearMatch) continue;
      const prefix = body.slice(0, yearMatch.index);
      for (const part of prefix.split(';')) record(part, yearMatch[1]);
    }
    for (const match of content.matchAll(narrativeYear)) record(match[1], match[2]);
  }
  return [...citations.values()];
}

function explicitIdentifiers(blocks) {
  const found = new Set();
  for (const block of blocks) {
    const content = String(block?.content || '');
    for (const match of content.matchAll(/10\.\d{4,9}\/[\-._;()/:A-Z0-9]+/giu)) {
      found.add('doi:' + match[0].replace(/[.,;]+$/, '').toLowerCase());
    }
    for (const match of content.matchAll(/\[(?:source|cite|reference):([^\]]+)\]/giu)) {
      found.add(folded(match[1]));
    }
    for (const match of content.matchAll(/https?:\/\/[^\s)\]]+/giu)) {
      found.add(match[0].replace(/[.,;]+$/, '').replace(/\/$/, '').toLowerCase());
    }
  }
  return found;
}

export function auditCitationReferences(blocks = [], sources = []) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const safeSources = Array.isArray(sources) ? sources : [];
  const sourceRecords = safeSources.map((source) => ({
    year: normalizedYear(source?.year || source?.date),
    aliases: authorAliases(source),
    identifiers: sourceIdentifiers(source),
  }));

  const unmatched = extractCitations(safeBlocks).filter((citation) => {
    return !sourceRecords.some((source) =>
      source.year === citation.year &&
      citation.authors.some((author) => source.aliases.has(author))
    );
  });

  const knownIdentifiers = new Set(sourceRecords.flatMap((source) => [...source.identifiers]));
  const unmatchedIdentifiers = [...explicitIdentifiers(safeBlocks)].filter((identifier) => {
    if (identifier.startsWith('doi:')) return !knownIdentifiers.has(identifier);
    return !knownIdentifiers.has(identifier) &&
      ![...knownIdentifiers].some((known) => known.endsWith(identifier) || identifier.endsWith(known));
  });

  return {
    unmatched,
    unmatchedIdentifiers,
    count: unmatched.length + unmatchedIdentifiers.length,
  };
}

export default auditCitationReferences;
