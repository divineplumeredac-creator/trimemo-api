// Only flag an unambiguous missing opening: a part heading directly followed
// by a chapter heading, or a chapter heading as the first content of a part.
// Other cases remain unverified rather than being treated as valid or invalid.
export function hasMissingPartOpening(content, structure = []) {
  if (!Array.isArray(structure) || !structure.some(s => /^\s*partie\s+[ivxlcdm0-9]+\b/iu.test(String(s)))) return false;
  const lines = String(content || '').split(/\r?\n/u).map(line => line.trim().replace(/^#{1,6}\s*/u, '').replace(/^\*\*|\*\*$/gu, '').trim()).filter(Boolean);
  if (!lines.length) return false;
  let index = 0;
  if (/^partie\s+[ivxlcdm0-9]+\b/iu.test(lines[index])) index++;
  return /^chapitre\s+\d+\b/iu.test(lines[index] || '');
}
