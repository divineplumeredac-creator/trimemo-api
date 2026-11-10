// Conservative warning only: a final orphaned determiner or connector can be
// produced when a block is cut. A negative result does not prove completeness.
export function hasClearlyIncompleteEnding(content) {
  const value = String(content || '').trim().replace(/["'»”\])}]+$/u, '').trim();
  return /(?:^|\s)(?:un|une|le|la|les|du|des|de|à|et|ou|mais|que|qui|pour|dans)\s*$/iu.test(value);
}
