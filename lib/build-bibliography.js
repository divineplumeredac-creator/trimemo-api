import { normalizeSources, sourceToApa } from './normalize-sources.js';
import { auditCitationReferences } from './citation-audit.js';

/** Source metadata from writing blocks and explicitly cited project references. */
export function buildBibliography(input = {}) {
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const usedBlockSources = blocks.flatMap(block => [
    ...(Array.isArray(block.sources) ? block.sources : []),
    ...(Array.isArray(block.papers) ? block.papers : []),
  ]);
  const globalSources = [
    ...(Array.isArray(input.papers) ? input.papers : []),
    ...(Array.isArray(input.sources) ? input.sources : []),
  ];
  const all = normalizeSources([...usedBlockSources, ...globalSources]);
  const initialMissing = auditCitationReferences(blocks, []).count;
  const global = normalizeSources(globalSources);
  const usedKeys = new Set(normalizeSources(usedBlockSources).map(source =>
    [source.author, source.year, source.title].join('|')
  ));
  const sources = all.filter(source =>
    usedKeys.has([source.author, source.year, source.title].join('|')) ||
    (global.some(g => g.author === source.author && g.year === source.year && g.title === source.title) &&
     auditCitationReferences(blocks, [source]).count < initialMissing)
  );
  return {
    sources,
    entries: sources.map(sourceToApa),
    incomplete: sources.filter(source =>
      source.author === 'Auteur non renseigné' || !source.title || source.year === 's. d.'
    ),
    count: sources.length,
  };
}
export default buildBibliography;
