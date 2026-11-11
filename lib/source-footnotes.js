import { auditCitationReferences } from './citation-audit.js';
import { sourceToApa } from './normalize-sources.js';

// Only existing, retained source metadata may become a note. The export adds
// the note reference at the end of its block, since no sentence anchor exists.
export function sourceFootnotes(content, sources = []) {
  const blocks = [{ content: String(content || '') }];
  const total = auditCitationReferences(blocks, []).count;
  if (!total) return [];
  const seen = new Set();
  const notes = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.verified !== true || !source.author || !source.title) continue;
    if (auditCitationReferences(blocks, [source]).count >= total) continue;
    const note = sourceToApa(source);
    if (!seen.has(note)) { seen.add(note); notes.push(note); }
  }
  return notes;
}
