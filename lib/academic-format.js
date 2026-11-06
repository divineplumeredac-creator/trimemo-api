export const DEFAULT_FORMATTING = Object.freeze({
  fontFamily: 'Times New Roman',
  bodySize: 12,
  partSize: 16,
  chapterSize: 14,
  sectionSize: 12,
  lineSpacing: 1.5,
  marginInches: 1,
  firstLineIndentInches: 0.5,
  paragraphAfterPoints: 6,
});

const ALLOWED_FONTS = new Set(['Times New Roman', 'Arial', 'Calibri', 'Aptos', 'Garamond']);

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function resolveFormatting(input = {}) {
  const fontFamily = String(input.fontFamily || DEFAULT_FORMATTING.fontFamily);
  return {
    fontFamily: ALLOWED_FONTS.has(fontFamily) ? fontFamily : DEFAULT_FORMATTING.fontFamily,
    bodySize: boundedNumber(input.bodySize, DEFAULT_FORMATTING.bodySize, 10, 14),
    partSize: boundedNumber(input.partSize, DEFAULT_FORMATTING.partSize, 14, 20),
    chapterSize: boundedNumber(input.chapterSize, DEFAULT_FORMATTING.chapterSize, 12, 18),
    sectionSize: boundedNumber(input.sectionSize, DEFAULT_FORMATTING.sectionSize, 11, 16),
    lineSpacing: boundedNumber(input.lineSpacing, DEFAULT_FORMATTING.lineSpacing, 1, 3),
    marginInches: boundedNumber(input.marginInches, DEFAULT_FORMATTING.marginInches, 0.5, 1.5),
    firstLineIndentInches: boundedNumber(input.firstLineIndentInches, DEFAULT_FORMATTING.firstLineIndentInches, 0, 1),
    paragraphAfterPoints: boundedNumber(input.paragraphAfterPoints, DEFAULT_FORMATTING.paragraphAfterPoints, 0, 18),
  };
}
