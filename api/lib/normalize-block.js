import { normalizeSources } from './normalize-sources.js';

function text(value) {
  return value == null ? '' : String(value).trim();
}

export function normalizeBlock(block = {}, index = 0) {
  const structure = Array.isArray(block.structure)
    ? block.structure.filter(Boolean).map(text)
    : [];

  const sources = normalizeSources([
    ...(Array.isArray(block.sources) ? block.sources : []),
    ...(Array.isArray(block.papers) ? block.papers : []),
  ]);

  return {
    ...block,
    id: text(block.id) || `block-${index + 1}`,
    partNumber: block.partNumber ?? block.part ?? null,
    chapterNumber: block.chapterNumber ?? block.chapter ?? null,
    sectionNumber: block.sectionNumber ?? block.section ?? null,
    subsectionNumber:
      block.subsectionNumber ?? block.subsection ?? null,
    blockOrder: Number(block.blockOrder ?? block.order ?? index + 1),
    structure,
    title: text(block.title),
    content: text(block.content || block.text || block.body),
    footnotes: Array.isArray(block.footnotes) ? block.footnotes : [],
    sources,
  };
}

export function normalizeBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .map(normalizeBlock)
    .sort((a, b) => a.blockOrder - b.blockOrder);
}
