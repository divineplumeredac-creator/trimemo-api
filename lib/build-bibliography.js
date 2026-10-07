import { normalizeSources, sourceToApa } from './normalize-sources.js';

export function buildBibliography(input = {}) {
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const usedBlockSources = blocks.flatMap((block) => [
    ...(Array.isArray(block.sources) ? block.sources : []),
    ...(Array.isArray(block.papers) ? block.papers : []),
  ]);

  // The bibliography must reflect sources actually attached to written blocks.
  // The global papers list is only a fallback for legacy projects where blocks
  // do not yet carry their source metadata.
  const candidates = usedBlockSources.length
    ? usedBlockSources
    : (Array.isArray(input.papers) ? input.papers : []);

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
