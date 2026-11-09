import { normalizeSources, sourceToApa } from './normalize-sources.js';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function sourceIdentity(source = {}) {
  const id = text(source.sourceId || source.source_id || source.paperId || source.paper_id || source.id);
  if (id) return 'id:' + id.toLowerCase();

  const doi = text(source.doi)
    .replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  if (doi) return 'doi:' + doi;

  const author = text(source.author || source.authors || source.auteur || source.organization || source.organisation)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const title = text(source.title || source.name || source.titre)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return author && title ? 'work:' + author + '|' + title : '';
}

function mergeSourceRecords(records) {
  const merged = new Map();
  const withoutStableIdentity = [];

  // Prefer verified metadata when two records describe the same source.
  const ordered = [...records].sort((a, b) => Number(b?.verified === true) - Number(a?.verified === true));
  for (const source of ordered) {
    if (!source || typeof source !== 'object') continue;
    const key = sourceIdentity(source);
    if (!key) {
      withoutStableIdentity.push(source);
      continue;
    }
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...source });
      continue;
    }
    for (const [field, value] of Object.entries(source)) {
      if ((current[field] == null || current[field] === '') && value != null && value !== '') {
        current[field] = value;
      }
    }
    if (source.verified === true) current.verified = true;
  }
  return [...merged.values(), ...withoutStableIdentity];
}

export function buildBibliography(input = {}) {
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const blockSources = blocks.flatMap((block) => [
    ...(Array.isArray(block?.sources) ? block.sources : []),
    ...(Array.isArray(block?.papers) ? block.papers : []),
  ]);
  const globalSources = Array.isArray(input.papers) ? input.papers : [];

  // Merge block-level and project-level records. Older projects may only have
  // the global list, so both sources of metadata remain supported.
  const candidates = mergeSourceRecords([...blockSources, ...globalSources]);
  const sources = normalizeSources(candidates);

  return {
    sources,
    entries: sources.map(sourceToApa),
    incomplete: sources.filter((source) =>
      source.author === 'Auteur non renseigné' ||
      !source.title ||
      source.year === 's. d.'
    ),
    count: sources.length,
  };
}

export default buildBibliography;
