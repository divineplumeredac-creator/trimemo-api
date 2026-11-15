function text(value) {
  return value == null ? '' : String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function cleanUrl(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?&](utm_(source|medium|campaign|term|content)|gclid|fbclid)=[^&\s]+/gi, '').replace(/[?&]$/, '');
  }
}

function canonicalAuthor(value) {
  const author = text(value);
  const key = author.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  if (/^(international labour organization|international labour office|organisation internationale du travail|oit)$/.test(key)) {
    return 'Organisation internationale du Travail';
  }
  if (/^(occupational safety and health administration|osha)$/.test(key)) {
    return 'Occupational Safety and Health Administration';
  }
  if (/^(national institute for occupational safety and health|niosh)$/.test(key)) {
    return 'National Institute for Occupational Safety and Health';
  }
  if (/^(health and safety executive|hse)$/.test(key)) {
    return 'Health and Safety Executive';
  }
  if (/^(international organization for standardization|international organisation for standardisation|iso)$/.test(key)) {
    return 'International Organization for Standardization';
  }
  if (/^(european agency for safety and health at work|eu-osha)$/.test(key)) {
    return 'European Agency for Safety and Health at Work';
  }
  return author || 'Auteur non renseigné';
}

function authorLabel(source) {
  return canonicalAuthor(source.author || source.authors || source.auteur || source.organization || source.organisation);
}

function sourceKey(source) {
  const doi = text(source.doi).toLowerCase().replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (doi) return "doi:" + doi;
  // Plusieurs blocs peuvent citer la même étude avec des URL différentes.
  const author = text(authorLabel(source)).toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  const title = text(source.title || source.name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  // Different editions of the same title must not lose their publication year.
  const year = text(source.year || source.date || 's. d.').toLowerCase().trim();
  if (author && title) return "work:" + author + "|" + year + "|" + title;
  return "url:" + cleanUrl(source.url || source.link).toLowerCase();
}

export function normalizeSource(source = {}) {
  const doi = text(source.doi).replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '');
  const url = cleanUrl(source.url || source.link);
  return {
    ...source,
    author: authorLabel(source),
    year: text(source.year || source.date || 's. d.'),
    title: text(source.title || source.name || source.titre),
    venue: text(source.venue || source.journal || source.publisher || source.editeur),
    type: text(source.type || source.sourceType || source.publicationType).toLowerCase(),
    journal: text(source.journal || source['container-title'] || (source.type === 'article' ? source.venue : '')),
    volume: text(source.volume),
    issue: text(source.issue || source.number),
    pages: text(source.pages || source.page),
    articleNumber: text(source.articleNumber || source.article_number),
    publisher: text(source.publisher || source.editeur),
    institution: text(source.institution || source.university),
    edition: text(source.edition),
    doi,
    url,
    verified: source.verified === true,
  };
}

export function normalizeSources(sources = []) {
  const map = new Map();
  for (const item of Array.isArray(sources) ? sources : []) {
    const normalized = normalizeSource(item);
    if (!normalized.title) continue;
    const key = sourceKey(normalized);
    if (!map.has(key)) {
      map.set(key, normalized);
    } else {
      // Conserver la notice la plus complète lorsque plusieurs blocs citent le même DOI.
      const previous = map.get(key);
      const merged = { ...previous };
      for (const field of ['type','journal','venue','volume','issue','pages','articleNumber','publisher','institution','edition','url','doi']) {
        if (!merged[field] && normalized[field]) merged[field] = normalized[field];
      }
      merged.verified = previous.verified === true || normalized.verified === true;
      if (normalized.title.length > String(previous.title || '').length &&
          normalized.title.toLowerCase().startsWith(String(previous.title || '').toLowerCase())) {
        merged.title = normalized.title;
      }
      map.set(key, merged);
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.author} ${a.year} ${a.title}`.localeCompare(`${b.author} ${b.year} ${b.title}`, 'fr')
  );
}

/**
 * Rendu APA 7 : segments typographiques conservés jusqu'au Word.
 * Les informations inconnues ne sont pas inventées.
 */
export function sourceToApaParts(input = {}) {
  const source = normalizeSource(input);
  const parts = [];
  const add = (textValue, italics = false) => { if (textValue) parts.push({ text: String(textValue), italics }); };
  const cleanEnd = value => String(value || '').replace(/[.\s]+$/u, '').trim();
  const { author, year, title } = source;
  add(`${author} (${year}). `);
  const type = source.type;
  const isThesis = /thesis|dissertation|doctorat|mémoire|these/iu.test(type);
  const isBook = /book|livre|ouvrage/iu.test(type);
  const isReport = /report|rapport/iu.test(type);
  const journal = source.journal || (!isBook && !isThesis && !isReport ? source.venue : '');
  const isJournal = /article|journal/iu.test(type) || Boolean(journal);
  add(cleanEnd(title) + '. ', !isJournal && (isBook || isThesis || isReport || /webpage|website|page web/iu.test(type)));
  if (isJournal) {
    if (journal) {
      add(cleanEnd(journal), true);
      if (source.volume) add(', ' + source.volume, true);
      if (source.issue) add('(' + source.issue + ')');
      if (source.pages) add(', ' + source.pages.replace(/(\d)-(\d)/gu, '$1–$2'));
      else if (source.articleNumber) add(', Article ' + source.articleNumber);
      add('. ');
    }
  } else if (isThesis) {
    add('[Thèse ou mémoire universitaire' + (source.institution ? ', ' + source.institution : '') + ']. ');
  } else if (isBook || isReport) {
    if (source.edition) add('(' + source.edition + '). ');
    if (source.publisher) add(source.publisher + '. ');
  } else if (source.venue || source.publisher) {
    add((source.venue || source.publisher) + '. ');
  }
  const link = source.doi ? `https://doi.org/${source.doi}` : source.url;
  if (link) add(link);
  // Aucun point après un DOI ou une URL en APA 7.
  else if (parts.length && !parts.at(-1).text.trimEnd().endsWith('.')) add('.');
  return parts;
}

export function sourceToApa(source = {}) {
  return sourceToApaParts(source).map(part => part.text).join('').trimEnd();
}
