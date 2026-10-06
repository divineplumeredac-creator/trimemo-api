export const DEFAULT_FORMATTING = Object.freeze({
  fontFamily: 'Times New Roman', bodySize: 12, partSize: 14, chapterSize: 13,
  sectionSize: 12, lineSpacing: 1.5, marginInches: 1,
});
export function resolveFormatting(input = {}) {
  return { ...DEFAULT_FORMATTING, ...input,
    bodySize: Number(input.bodySize || DEFAULT_FORMATTING.bodySize),
    partSize: Number(input.partSize || DEFAULT_FORMATTING.partSize),
    chapterSize: Number(input.chapterSize || DEFAULT_FORMATTING.chapterSize),
    sectionSize: Number(input.sectionSize || DEFAULT_FORMATTING.sectionSize),
    lineSpacing: Number(input.lineSpacing || DEFAULT_FORMATTING.lineSpacing),
  };
}
