function text(value) { return value == null ? '' : String(value).trim(); }

async function fetchWithTimeout(url, options = {}, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' }); }
  finally { clearTimeout(timer); }
}

function isSafePublicUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false; // pas d'adresse IP brute
    if (h.startsWith('[') || h.includes(':')) return false; // pas d'IPv6 littérale
    return true;
  } catch { return false; }
}

function titleKey(value) {
  return text(value).replace(/<[^>]+>/g, ' ').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function authorsFromCrossref(authors) {
  const names = (Array.isArray(authors) ? authors : []).map(author => {
    const family = text(author?.family);
    if (!family) return text(author?.name);
    const initials = text(author?.given).split(/[\s.-]+/u).filter(Boolean).map(word => word[0].toUpperCase() + '.').join(' ');
    return family + (initials ? ', ' + initials : '');
  }).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ', & ' + names.at(-1);
}

// Cache only public Crossref records, never client-provided source objects.
// The DOI/title match is performed anew for each source.
const crossrefCache = new Map();
let crossrefFetch = globalThis.fetch;
const CROSSREF_CACHE_MS = 5 * 60 * 1000;
async function fetchCrossrefRecord(doi) {
  if (crossrefFetch !== globalThis.fetch) { crossrefCache.clear(); crossrefFetch = globalThis.fetch; }
  const key = String(doi).toLowerCase();
  const cached = crossrefCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (cached) crossrefCache.delete(key);
  const promise = (async () => {
    const response = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Crossref indisponible');
    const payload = await response.json();
    return payload?.message || {};
  })();
  crossrefCache.set(key, {expires: Date.now() + CROSSREF_CACHE_MS, promise});
  if (crossrefCache.size > 256) crossrefCache.delete(crossrefCache.keys().next().value);
  try { return await promise; } catch (error) {
    if (crossrefCache.get(key)?.promise === promise) crossrefCache.delete(key);
    throw error;
  }
}

async function verifyOne(source) {
  const doi = text(source.doi).replace(/^https?:\/\/doi\.org\//i, '');
  const url = text(source.url);
  if (doi) {
    try {
      {
        const record = await fetchCrossrefRecord(doi);
        const officialTitle = Array.isArray(record.title) ? text(record.title[0]) : '';
        // A DOI existing is not proof that it belongs to the cited title.
        // Do not attach authoritative metadata to a different work.
        if (!officialTitle || !titleKey(source.title) || titleKey(source.title) !== titleKey(officialTitle)) {
          return { ...source, doi, verified: false, verification: 'doi_title_mismatch' };
        }
        const officialAuthors = authorsFromCrossref(record.author);
        const container = Array.isArray(record['container-title']) ? text(record['container-title'][0]) : '';
        const recordType = text(record.type);
        const sourceType = recordType === 'journal-article' ? 'article'
          : recordType === 'book' ? 'book'
          : recordType === 'dissertation' ? 'thesis'
          : recordType === 'report' ? 'report'
          : recordType === 'book-chapter' ? 'chapter' : '';
        const journal = sourceType === 'article' ? container : '';
        // Une vérification Crossref déjà effectuée apporte les champs APA sans second appel réseau.
        return {
          ...source, doi, title: officialTitle,
          ...(officialAuthors ? { author: officialAuthors } : {}),
          ...(sourceType ? { type: sourceType } : {}),
          ...(container ? { venue: container } : {}),
          ...(journal ? { journal } : {}),
          ...(record.volume ? { volume: text(record.volume) } : {}),
          ...(record.issue ? { issue: text(record.issue) } : {}),
          ...(record.page ? { pages: text(record.page) } : {}),
          ...(record['article-number'] ? { articleNumber: text(record['article-number']) } : {}),
          ...((sourceType === 'book' || sourceType === 'report') && record.publisher ? { publisher: text(record.publisher) } : {}),
          verified: true, verification: 'crossref_title_match'
        };
      }
    } catch {}
  }
  if (url && isSafePublicUrl(url)) {
    try {
      const r = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'User-Agent': 'Trimemo/1.0 bibliography-check' } });
      if (r.ok || (r.status >= 300 && r.status < 400)) return { ...source, verified: true, verification: 'url' };
    } catch {}
  }
  return { ...source, verified: false };
}

export async function verifySources(sources = []) {
  const list = Array.isArray(sources) ? sources.slice(0, 12) : [];
  const out = [];
  for (let i = 0; i < list.length; i += 4) {
    const batch = await Promise.all(list.slice(i, i + 4).map(verifyOne));
    out.push(...batch);
  }
  return [...out, ...(Array.isArray(sources) ? sources.slice(12).map((s) => ({ ...s, verified: false })) : [])];
}
