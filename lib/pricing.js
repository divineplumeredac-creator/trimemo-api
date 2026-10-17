import crypto from "node:crypto";

const RATES = {
  africa: { currency: "XOF", label: "Afrique francophone", rates: { devoir: 150, rapport: 200, memoire: 250, article: 300, these: 300 } },
  europe: { currency: "EUR", label: "Europe", rates: { devoir: 0.40, rapport: 0.60, memoire: 0.80, article: 1.00, these: 1.30 } },
  northAmerica: { currency: "USD", label: "Canada / États-Unis", rates: { devoir: 0.50, rapport: 0.75, memoire: 1.00, article: 1.25, these: 1.60 } },
  international: { currency: "USD", label: "Marché international", rates: { devoir: 0.50, rapport: 0.75, memoire: 1.00, article: 1.25, these: 1.60 } },
};
const LEVEL_COEFFICIENTS = { licence: 1, master: 1.15, doctorat: 1.4 };
const COMPLEXITY_COEFFICIENTS = { faible: 0.9, moyenne: 1, elevee: 1.2 };
const AFRICA = new Set(["DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","CI","DJ","EG","GQ","ER","SZ","ET","GA","GM","GH","GN","GW","KE","LS","LR","LY","MG","MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW","ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW"]);
const EUROPE = new Set(["AL","AD","AT","BY","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IE","IT","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","RU","SM","RS","SK","SI","ES","SE","CH","UA","GB","VA"]);
const LEVEL_MAP = [
  [/doctor|doctoral|phd|doctorat/i, "doctorat"],
  [/master|mba|m[12](?:\s|$)/i, "master"],
  [/licence|bachelor|undergraduate|l[123](?:\s|$)/i, "licence"],
];
function normalizeCountry(value) { return String(value || "").trim().toUpperCase().slice(0, 2); }
export function marketForCountry(countryValue, pricingConfig = null) {
  const country = normalizeCountry(countryValue);
  const market = AFRICA.has(country) ? "africa" : (country === "CA" || country === "US") ? "northAmerica" : EUROPE.has(country) ? "europe" : "international";
  const base = RATES[market];
  const override = pricingConfig?.markets?.[market] || {};
  return { country: country || "UNKNOWN", market, currency: override.currency || base.currency, label: override.label || base.label, rates: { ...base.rates, ...(override.rates || {}) } };
}
export function normalizeDocumentType(value) {
  const v = String(value || "").toLowerCase();
  if (/th[eè]se|doctoral|doctorat/.test(v)) return "these";
  if (/article/.test(v)) return "article";
  if (/rapport|stage/.test(v)) return "rapport";
  if (/devoir|dissertation|exercice/.test(v)) return "devoir";
  return "memoire";
}
export function normalizeLevel(value) {
  const v = String(value || "");
  return LEVEL_MAP.find(([pattern]) => pattern.test(v))?.[1] || "licence";
}
export function normalizeComplexity(value) {
  const v = String(value || "").toLowerCase();
  if (/élev|eleve|high|fort/.test(v)) return "elevee";
  if (/faible|low|simple/.test(v)) return "faible";
  return "moyenne";
}
export function calculateQuote({ project = {}, country = "UNKNOWN", complexity = "moyenne", reasons = [], pricingConfig = null } = {}) {
  const selectedMarket = marketForCountry(country, pricingConfig);
  const docType = normalizeDocumentType(project.typeDoc || project.typeDocument || project.type);
  const level = normalizeLevel(project.niveau || project.level);
  const complexityKey = normalizeComplexity(complexity);
  const pages = Math.min(300, Math.max(1, Math.round(Number(project.pages) || 1)));
  const baseRate = selectedMarket.rates[docType];
  const levelCoefficient = Number(pricingConfig?.levelCoefficients?.[level] ?? LEVEL_COEFFICIENTS[level]);
  const complexityCoefficient = Number(pricingConfig?.complexityCoefficients?.[complexityKey] ?? COMPLEXITY_COEFFICIENTS[complexityKey]);
  const raw = pages * baseRate * levelCoefficient * complexityCoefficient;
  const amount = selectedMarket.currency === "XOF" ? Math.round(raw) : Math.round(raw * 100) / 100;
  const checkoutCurrency = selectedMarket.currency === "XOF" ? "EUR" : selectedMarket.currency;
  const checkoutAmount = selectedMarket.currency === "XOF"
    ? (Math.round((amount / 655.957) * 100) / 100).toFixed(2)
    : amount.toFixed(2);
  return {
    country: selectedMarket.country,
    market: selectedMarket.market,
    marketLabel: selectedMarket.label,
    currency: selectedMarket.currency,
    documentType: docType,
    level,
    complexity: complexityKey,
    pages,
    wordsPerPage: 320,
    baseRate,
    levelCoefficient,
    complexityCoefficient,
    estimatedAmount: amount,
    formattedAmount: new Intl.NumberFormat("fr-FR", { maximumFractionDigits: selectedMarket.currency === "XOF" ? 0 : 2, minimumFractionDigits: selectedMarket.currency === "XOF" ? 0 : 2 }).format(amount),
    checkoutCurrency,
    checkoutAmount,
    reasons: Array.isArray(reasons) ? reasons.slice(0, 5).map(x => String(x).slice(0, 220)) : [],
    status: "provisional",
  };
}
function secret() {
  return String(process.env.TRIMEMO_PRICING_SECRET || "").trim();
}
function projectFingerprint(project = {}) {
  const files = (Array.isArray(project.files) ? project.files : []).map(file => ({
    name: String(file?.name || ""),
    type: String(file?.type || ""),
    category: String(file?.category || ""),
    contentHash: crypto.createHash("sha256").update(String(file?.content || "")).digest("hex"),
  }));
  const inputs = {
    projectId: String(project.projectId || project.project_id || ""),
    subject: String(project.sujet || project.subject || "").trim(),
    documentType: normalizeDocumentType(project.typeDoc || project.typeDocument || project.type),
    level: normalizeLevel(project.niveau || project.level),
    domain: String(project.domaine || "").trim(),
    context: String(project.contexte || "").trim(),
    instructions: String(project.consignes || "").trim(),
    personalProblematic: String(project.problematiquePersonnelle || "").trim(),
    personalPlan: String(project.planPersonnel || "").trim(),
    pages: Number(project.pages),
    files,
  };
  return crypto.createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}
export function signPricingQuote(quote, project = {}) {
  const key = secret();
  if (!key) throw new Error("TRIMEMO_PRICING_SECRET ou un secret serveur de paiement doit être configuré pour signer les estimations.");
  const payload = {
    projectId: String(project.projectId || project.project_id || ""),
    subject: String(project.sujet || project.subject || "").trim(),
    pages: quote.pages,
    documentType: quote.documentType,
    level: quote.level,
    complexity: quote.complexity,
    country: quote.country,
    market: quote.market,
    currency: quote.currency,
    estimatedAmount: quote.estimatedAmount,
    checkoutCurrency: quote.checkoutCurrency,
    checkoutAmount: quote.checkoutAmount,
    fingerprint: projectFingerprint(project),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", key).update(encoded).digest("base64url");
  return encoded + "." + signature;
}
export function verifyPricingQuoteIdentity(token, project = {}) {
  const key = secret();
  if (!key || !token || typeof token !== "string") return null;
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = crypto.createHmac("sha256", key).update(encoded).digest("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return null; }
  const projectId = String(project.projectId || project.project_id || "");
  const subject = String(project.sujet || project.subject || "").trim();
  if (!projectId || payload.projectId !== projectId || payload.subject !== subject) return null;
  if (Number(project.pages) !== Number(payload.pages)) return null;
  if (payload.documentType !== normalizeDocumentType(project.typeDoc || project.typeDocument || project.type)) return null;
  if (payload.level !== normalizeLevel(project.niveau || project.level)) return null;
  if (!payload.fingerprint || Date.now() - Number(payload.issuedAt || 0) > 24 * 60 * 60 * 1000) return null;
  return payload;
}

export function verifyPricingQuote(token, project = {}) {
  const payload = verifyPricingQuoteIdentity(token, project);
  if (!payload || payload.fingerprint !== projectFingerprint(project)) return null;
  return payload;
}
