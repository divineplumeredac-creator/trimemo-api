function text(value) { return value == null ? '' : String(value).trim(); }

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
  if (doi) return `doi:${doi}`;
  const url = cleanUrl(source.url || source.link).toLowerCase();
  if (url) return `url:${url}`;
  return [
    authorLabel(source).toLowerCase(),
    text(source.year || source.date).toLowerCase(),
    text(source.title || source.name).toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
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
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.author} ${a.year} ${a.title}`.localeCompare(`${b.author} ${b.year} ${b.title}`, 'fr')
  );
}

export function sourceToApa(source = {}) {
  const author = source.author || 'Auteur non renseigné';
  const year = source.year || 's. d.';
  const title = source.title || 'Titre non renseigné';
  const venue = source.venue ? `. ${source.venue}` : '';
  const link = source.doi ? `https://doi.org/${source.doi}` : source.url;
  return `${author} (${year}). ${title}${venue}${link ? `. ${link}` : ''}.`;
}
