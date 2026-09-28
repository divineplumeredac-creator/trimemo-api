import { normalizeSources, sourceToApa } from './lib/normalize-sources.js';

export function buildBibliography(input = {}) {
  const blockSources = (Array.isArray(input.blocks) ? input.blocks : []).flatMap((block) => [
    ...(Array.isArray(block.sources) ? block.sources : []),
    ...(Array.isArray(block.papers) ? block.papers : []),
  ]);
  const sources = normalizeSources([
    ...(Array.isArray(input.papers) ? input.papers : []),
    ...blockSources,
  ]);
  return {
    sources,
    entries: sources.map(sourceToApa),
    incomplete: sources.filter(
      (source) =>
        source.author === 'Auteur non renseigné' ||
        !source.title ||
        source.year === 's. d.'
    ),
  };
}

export default buildBibliography;
