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

async function verifyOne(source) {
  const doi = text(source.doi).replace(/^https?:\/\/doi\.org\//i, '');
  const url = text(source.url);
  if (doi) {
    try {
      const r = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' } });
      if (r.ok) return { ...source, doi, verified: true, verification: 'crossref' };
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
