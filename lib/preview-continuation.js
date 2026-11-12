// Preserve every character: the displayed prefix and the private suffix must
// reconstruct the original output byte-for-byte when payment is confirmed.
export function splitPreviewText(value, limit) {
  const source = String(value || '');
  const count = Number(limit);
  if (!Number.isSafeInteger(count) || count <= 0) return { visible: '', remainder: source };
  const words = [...source.matchAll(/\S+/gu)];
  if (words.length <= count) return { visible: source, remainder: '' };
  const last = words[count - 1];
  const candidate = source.slice(0, last.index + last[0].length);
  const boundaries = [...candidate.matchAll(/[.!?…](?:[»”"')\]]*)?(?=\s|$)/gu)].filter(match => {
    if (!match[0].startsWith('.')) return true;
    const before = candidate.slice(0, match.index + 1);
    // Les abréviations et initiales courantes ne terminent pas une phrase.
    return !/(?:\b(?:M|Mme|Mlle|Dr|Pr|Prof|St|Ste|cf|env|ex|fig|chap|vol|p|pp|n|no|etc|al)|\b[A-ZÀ-ÖØ-Þ])\.$/iu.test(before);
  });
  if (!boundaries.length) return { visible: '', remainder: source };
  const boundary = boundaries[boundaries.length - 1];
  const end = boundary.index + boundary[0].length;
  return { visible: source.slice(0, end), remainder: source.slice(end) };
}

