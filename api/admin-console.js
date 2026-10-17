import { requireOwner } from "../lib/owner-auth.js";
import { setCors } from "../lib/http.js";
import { readAdminSettings, writeAdminSettings, supabaseAdminConfig, supabaseAdminRequest } from "../lib/admin-data.js";
import { logAdminEvent } from "../lib/admin-telemetry.js";
import mammoth from "mammoth";

const DEFAULT_MARKETS = ["africa", "europe", "northAmerica", "international"];
const DOCUMENT_TYPES = ["devoir", "rapport", "memoire", "article", "these"];

function reply(res, status, payload) { return res.status(status).json(payload); }
function errorStatus(error) { return Number(error?.status) || 500; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function safeStr(value, max = 300) { return String(value ?? "").trim().slice(0, max); }
function safeNumber(value, min, max, field) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    const error = new Error("Valeur invalide pour " + field + ".");
    error.status = 400;
    throw error;
  }
  return num;
}
async function authAdminRequest(path, init = {}) {
  const { url, key } = supabaseAdminConfig();
  const response = await fetch(url + path, {
    ...init,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const error = new Error(String(data?.msg || data?.message || data?.error_description || "Opération Auth impossible.").slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return data;
}
async function getAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 50; page++) {
    const data = await authAdminRequest("/auth/v1/admin/users?page=" + page + "&per_page=100");
    const batch = asArray(data?.users || data);
    users.push(...batch);
    if (batch.length < 100) break;
  }
  return users;
}
async function getAllRows(path, pageSize = 1000, maxRows = 10000) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const sep = path.includes("?") ? "&" : "?";
    const result = await supabaseAdminRequest(path + sep + "limit=" + pageSize + "&offset=" + offset);
    const batch = asArray(result.data);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
function formatUser(user, projectCounts = {}) {
  const until = user?.banned_until ? Date.parse(user.banned_until) : 0;
  const isBanned = Number.isFinite(until) && until > Date.now();
  return {
    id: user.id,
    email: safeStr(user.email, 254),
    created_at: user.created_at || null,
    last_sign_in_at: user.last_sign_in_at || null,
    banned_until: user.banned_until || null,
    disabled: isBanned || user?.app_metadata?.trimemo_access === "suspended",
    access: user?.app_metadata?.trimemo_access === "suspended" ? "suspended" : (isBanned ? "suspended" : "active"),
    project_count: Number(projectCounts[user.id] || 0),
    display_name: safeStr(user?.user_metadata?.full_name || user?.user_metadata?.name || "", 120),
  };
}
function blockStats(state, membership = {}) {
  const blocks = asArray(state?.blocks || state?.document?.blocks || state?.writing?.blocks);
  const completed = blocks.filter(block => block?.status === "done" && String(block?.content || "").trim());
  const target = blocks.reduce((sum, block) => sum + Math.max(0, Number(block?.expectedWords || 0)), 0);
  const words = completed.reduce((sum, block) => sum + Math.max(0, Number(block?.wordCount || String(block?.content || "").trim().split(/\s+/u).filter(Boolean).length)), 0);
  const percent = target > 0 ? Math.min(100, Math.round(words / target * 100)) : (blocks.length ? Math.round(completed.length / blocks.length * 100) : 0);
  const project = state?.project || {};
  return {
    subject: safeStr(membership.subject || project.sujet || project.subject || state?.subject || "Projet sans titre", 240),
    level: safeStr(project.niveau || project.level || "", 60),
    domain: safeStr(project.domaine || project.discipline || "", 100),
    document_type: safeStr(project.typeDoc || project.documentType || "", 80),
    status: safeStr(membership.payment_status || state?.status || "draft", 40),
    progress_percent: percent,
    blocks_done: completed.length,
    blocks_total: blocks.length,
    words_written: words,
    updated_at: membership.updated_at || state?.updated_at || null,
  };
}
function money(value) {
  const num = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : 0;
}
function aggregateRevenue(orders) {
  const currencies = {};
  const months = {};
  for (const order of orders) {
    const currency = safeStr(order.currency || "UNKNOWN", 12).toUpperCase();
    const amount = money(order.amount);
    const refund = order.refund_status === "refunded" || order.status === "refunded" ? money(order.refund_amount || order.amount) : 0;
    currencies[currency] ||= { currency, gross: 0, refunds: 0, net: 0, pending: 0, paid_orders: 0, refunded_orders: 0 };
    const item = currencies[currency];
    if (["paid", "consumed", "refunded"].includes(order.status)) {
      item.gross += amount;
      item.paid_orders += 1;
    } else if (order.status === "pending") item.pending += amount;
    if (refund > 0) { item.refunds += refund; item.refunded_orders += 1; }
    item.net = item.gross - item.refunds;
    if (order.paid_at) {
      const month = String(order.paid_at).slice(0, 7);
      const key = month + "|" + currency;
      months[key] ||= { month, currency, gross: 0, refunds: 0, net: 0 };
      if (order.status !== "pending") months[key].gross += amount;
      months[key].refunds += refund;
      months[key].net = months[key].gross - months[key].refunds;
    }
  }
  return {
    by_currency: Object.values(currencies).map(v => Object.fromEntries(Object.entries(v).map(([k, n]) => [k, typeof n === "number" ? Number(n.toFixed(2)) : n]))),
    by_month: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map(v => ({ ...v, gross: Number(v.gross.toFixed(2)), refunds: Number(v.refunds.toFixed(2)), net: Number(v.net.toFixed(2)) })),
  };
}
async function loadClients() {
  const [users, memberships] = await Promise.all([
    getAllAuthUsers(),
    getAllRows("/rest/v1/trimemo_client_projects?select=user_id,project_id"),
  ]);
  const counts = {};
  for (const row of memberships) counts[row.user_id] = (counts[row.user_id] || 0) + 1;
  return users.map(user => formatUser(user, counts)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
async function loadProjects() {
  const [memberships, states, users] = await Promise.all([
    getAllRows("/rest/v1/trimemo_client_projects?select=user_id,project_id,subject,payment_status,created_at,updated_at&order=updated_at.desc"),
    getAllRows("/rest/v1/trimemo_project_state?select=project_id,state,updated_at&order=updated_at.desc"),
    getAllAuthUsers(),
  ]);
  const membershipById = new Map(memberships.map(row => [String(row.project_id), row]));
  const userById = new Map(users.map(user => [String(user.id), safeStr(user.email, 254)]));
  const stateById = new Map(states.map(row => [String(row.project_id), row]));
  const ids = new Set([...membershipById.keys(), ...stateById.keys()]);
  return [...ids].map(id => {
    const membership = membershipById.get(id) || {};
    const stateRow = stateById.get(id) || {};
    const state = stateRow.state || {};
    const stats = blockStats(state, membership);
    return {
      project_id: id,
      subject: stats.subject,
      email: userById.get(String(membership.user_id)) || "",
      user_id: membership.user_id || null,
      level: stats.level,
      domain: stats.domain,
      document_type: stats.document_type,
      status: stats.status,
      progress_percent: stats.progress_percent,
      blocks_done: stats.blocks_done,
      blocks_total: stats.blocks_total,
      words_written: stats.words_written,
      created_at: membership.created_at || null,
      updated_at: stats.updated_at,
    };
  }).sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
}
async function loadOrders() {
  const orders = await getAllRows("/rest/v1/trimemo_orders?select=order_id,project_id,status,amount,currency,capture_id,created_at,paid_at,consumed_at,refund_status,refunded_at,refund_id,refund_amount,updated_at&order=created_at.desc");
  const memberships = await getAllRows("/rest/v1/trimemo_client_projects?select=project_id,subject,user_id");
  const states = await getAllRows("/rest/v1/trimemo_project_state?select=project_id,state");
  const users = await getAllAuthUsers();
  const userById = new Map(users.map(user => [String(user.id), safeStr(user.email, 254)]));
  const subjectById = new Map();
  for (const row of memberships) subjectById.set(String(row.project_id), { subject: row.subject, user_id: row.user_id });
  for (const row of states) {
    const s = row.state?.project || {};
    const id = String(row.project_id);
    if (!subjectById.has(id)) subjectById.set(id, { subject: s.sujet || s.subject || "Projet sans titre", user_id: null });
  }
  const clean = orders.map(order => {
    const link = subjectById.get(String(order.project_id)) || {};
    return {
      order_id: order.order_id, project_id: order.project_id, subject: safeStr(link.subject || "Projet non relié", 240),
      customer_email: userById.get(String(link.user_id)) || "",
      status: order.status, amount: order.amount, currency: order.currency,
      has_capture: Boolean(order.capture_id), capture_id: order.capture_id || null,
      created_at: order.created_at, paid_at: order.paid_at, consumed_at: order.consumed_at,
      refund_status: order.refund_status || "none", refunded_at: order.refunded_at || null,
      refund_id: order.refund_id || null, refund_amount: order.refund_amount || null,
    };
  });
  return { orders: clean, revenue: aggregateRevenue(orders) };
}
async function loadUsage() {
  const rows = await getAllRows("/rest/v1/trimemo_openai_usage?select=id,endpoint,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd,status,duration_ms,request_id,error_code,metadata,created_at&order=created_at.desc", 1000, 5000);
  const summary = rows.reduce((acc, row) => {
    acc.requests += 1;
    acc.input_tokens += Number(row.input_tokens || 0);
    acc.output_tokens += Number(row.output_tokens || 0);
    acc.total_tokens += Number(row.total_tokens || 0);
    if (row.status === "error") acc.errors += 1;
    if (row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined) {
      acc.estimated_cost_usd += money(row.estimated_cost_usd);
      acc.cost_coverage += 1;
    }
    const key = safeStr(row.endpoint || "unknown", 100);
    acc.by_endpoint[key] ||= { endpoint: key, calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0, priced_calls: 0, errors: 0 };
    const entry = acc.by_endpoint[key];
    entry.calls += 1; entry.input_tokens += Number(row.input_tokens || 0); entry.output_tokens += Number(row.output_tokens || 0);
    entry.total_tokens += Number(row.total_tokens || 0);
    if (row.status === "error") entry.errors += 1;
    if (row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined) {
      entry.estimated_cost_usd += money(row.estimated_cost_usd); entry.priced_calls += 1;
    }
    return acc;
  }, { requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0, cost_coverage: 0, errors: 0, by_endpoint: {} });
  summary.estimated_cost_usd = Number(summary.estimated_cost_usd.toFixed(6));
  return { summary, by_endpoint: Object.values(summary.by_endpoint).map(v => ({ ...v, estimated_cost_usd: Number(v.estimated_cost_usd.toFixed(6)) })), records: rows.slice(0, 300).map(row => ({ ...row, metadata: row.metadata || {} })) };
}
function validateSettings(body) {
  const currentDefaults = {
    markets: {
      africa: { currency: "XOF", label: "Afrique francophone", rates: { devoir: 150, rapport: 200, memoire: 250, article: 300, these: 300 } },
      europe: { currency: "EUR", label: "Europe", rates: { devoir: 0.4, rapport: 0.6, memoire: 0.8, article: 1, these: 1.3 } },
      northAmerica: { currency: "USD", label: "Canada / États-Unis", rates: { devoir: 0.5, rapport: 0.75, memoire: 1, article: 1.25, these: 1.6 } },
      international: { currency: "USD", label: "Marché international", rates: { devoir: 0.5, rapport: 0.75, memoire: 1, article: 1.25, these: 1.6 } },
    },
    levelCoefficients: { licence: 1, master: 1.15, doctorat: 1.4 },
    complexityCoefficients: { faible: 0.9, moyenne: 1, elevee: 1.2 },
  };
  const supplied = body.pricing_config || {};
  const config = { markets: {}, levelCoefficients: {}, complexityCoefficients: {} };
  for (const market of DEFAULT_MARKETS) {
    const base = currentDefaults.markets[market];
    const input = supplied.markets?.[market] || {};
    const currency = safeStr(input.currency || base.currency, 6).toUpperCase();
    if (!["XOF", "EUR", "USD", "CAD"].includes(currency)) { const e = new Error("Devise non prise en charge."); e.status = 400; throw e; }
    const rates = {};
    for (const type of DOCUMENT_TYPES) rates[type] = safeNumber(input.rates?.[type] ?? base.rates[type], 0, 1000000, market + "." + type);
    config.markets[market] = { currency, label: safeStr(input.label || base.label, 80), rates };
  }
  for (const level of ["licence", "master", "doctorat"]) config.levelCoefficients[level] = safeNumber(supplied.levelCoefficients?.[level] ?? currentDefaults.levelCoefficients[level], 0.1, 10, "coefficient " + level);
  for (const complexity of ["faible", "moyenne", "elevee"]) config.complexityCoefficients[complexity] = safeNumber(supplied.complexityCoefficients?.[complexity] ?? currentDefaults.complexityCoefficients[complexity], 0.1, 10, "complexité " + complexity);
  const rawQuotas = body.quotas || {};
  const quotas = {
    maxProblematicGenerations: Math.round(safeNumber(rawQuotas.maxProblematicGenerations ?? 3, 1, 10, "quota de problématiques")),
    maxPlanGenerations: Math.round(safeNumber(rawQuotas.maxPlanGenerations ?? 3, 1, 10, "quota de plans")),
    freePreviewWords: Math.round(safeNumber(rawQuotas.freePreviewWords ?? 2500, 0, 2500, "aperçu gratuit")),
    wordsPerPage: Math.round(safeNumber(rawQuotas.wordsPerPage ?? 320, 100, 1000, "mots par page")),
    maxPages: Math.round(safeNumber(rawQuotas.maxPages ?? 300, 1, 300, "pages maximum")),
  };
  const costs = body.usage_costs || {};
  function optionalRate(value, field) {
    if (value === null || value === undefined || value === "") return null;
    return safeNumber(value, 0, 1000000, field);
  }
  const usage_costs = {
    inputUsdPerMillion: optionalRate(costs.inputUsdPerMillion, "coût OpenAI entrée"),
    outputUsdPerMillion: optionalRate(costs.outputUsdPerMillion, "coût OpenAI sortie"),
  };
  return { pricing_config: config, quotas, usage_costs };
}
async function findOrder(orderId) {
  const query = "/rest/v1/trimemo_orders?order_id=eq." + encodeURIComponent(orderId) + "&select=order_id,project_id,status,amount,currency,capture_id,refund_status,refund_id,refund_amount&limit=1";
  const result = await supabaseAdminRequest(query);
  return asArray(result.data)[0] || null;
}
function paypalBaseUrl() {
  return String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
async function getPaypalToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "");
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || "");
  if (!clientId || !secret) { const e = new Error("Les identifiants PayPal serveur ne sont pas configurés."); e.status = 503; throw e; }
  const response = await fetch(paypalBaseUrl() + "/v1/oauth2/token", {
    method: "POST", headers: { Authorization: "Basic " + Buffer.from(clientId + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials", signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) { const e = new Error("PayPal n'a pas délivré de jeton pour le remboursement."); e.status = 502; throw e; }
  return data.access_token;
}
async function updateOrder(orderId, payload) {
  const query = "/rest/v1/trimemo_orders?order_id=eq." + encodeURIComponent(orderId);
  const result = await supabaseAdminRequest(query, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }) });
  return asArray(result.data)[0] || null;
}
async function refreshRefund(order) {
  if (!order.refund_id || order.refund_status !== "processing") return order;
  const token = await getPaypalToken();
  const response = await fetch(paypalBaseUrl() + "/v2/payments/refunds/" + encodeURIComponent(order.refund_id), { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const e = new Error("Impossible de vérifier l'état du remboursement PayPal."); e.status = 502; throw e; }
  const status = String(data.status || "").toUpperCase();
  if (status === "COMPLETED") return updateOrder(order.order_id, { status: "refunded", refund_status: "refunded", refunded_at: new Date().toISOString(), refund_amount: String(data?.amount?.value || order.amount) });
  if (status === "FAILED" || status === "CANCELLED") return updateOrder(order.order_id, { refund_status: "failed" });
  return order;
}
async function refundOrder(orderId, actor) {
  let order = await findOrder(orderId);
  if (!order) { const e = new Error("Commande introuvable."); e.status = 404; throw e; }
  if (order.refund_status === "refunded" || order.status === "refunded") { const e = new Error("Cette commande a déjà été remboursée."); e.status = 409; throw e; }
  if (order.refund_status === "processing") return refreshRefund(order);
  if (!["paid", "consumed"].includes(order.status)) { const e = new Error("Seules les commandes payées peuvent être remboursées."); e.status = 409; throw e; }
  if (!order.capture_id) { const e = new Error("Aucun identifiant de capture PayPal n'est associé à cette commande. Remboursement automatique indisponible."); e.status = 409; throw e; }
  const token = await getPaypalToken();
  const response = await fetch(paypalBaseUrl() + "/v2/payments/captures/" + encodeURIComponent(order.capture_id) + "/refund", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json", "PayPal-Request-Id": "trimemo-refund-" + String(order.order_id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 70) },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await updateOrder(order.order_id, { refund_status: "failed" }).catch(() => null);
    await logAdminEvent({ actor, category: "payment", severity: "error", action: "refund_failed", message: "PayPal a rejeté le remboursement.", statusCode: response.status, metadata: { orderId: order.order_id, providerIssue: safeStr(data?.details?.[0]?.issue || data?.name || "", 100) } });
    const e = new Error("PayPal a rejeté le remboursement. Consultez les journaux et vérifiez la commande avant une nouvelle tentative."); e.status = 502; throw e;
  }
  const status = String(data.status || "").toUpperCase();
  const payload = {
    refund_id: data.id || null,
    refund_status: status === "COMPLETED" ? "refunded" : "processing",
    refund_amount: String(data?.amount?.value || order.amount),
    refunded_at: status === "COMPLETED" ? new Date().toISOString() : null,
    ...(status === "COMPLETED" ? { status: "refunded" } : {}),
  };
  const updated = await updateOrder(order.order_id, payload);
  await logAdminEvent({ actor, category: "payment", severity: status === "COMPLETED" ? "warning" : "info", action: "refund_" + (status === "COMPLETED" ? "completed" : "processing"), message: status === "COMPLETED" ? "Remboursement PayPal confirmé." : "Remboursement PayPal lancé et en attente.", metadata: { orderId: order.order_id, refundId: data.id || null, currency: order.currency, amount: payload.refund_amount } });
  return updated || { ...order, ...payload };
}

export default async function handler(req, res) {
  setCors(res, req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return reply(res, 405, { ok: false, error: "Utilisez POST." });
  let actor = "owner";
  try {
    const { action } = req.body || {};
    const revisionActions = ["revision-submit","revision-quote","revision-client-list","revision-client-file"];
    if (revisionActions.includes(String(action || ""))) {
      const body=req.body||{}, token=safeStr(body.token,5000);
      const {url,key}=supabaseAdminConfig();
      const authResponse=await fetch(url+"/auth/v1/user",{headers:{apikey:key,Authorization:"Bearer "+token},signal:AbortSignal.timeout(8000)});
      const clientUser=await authResponse.json().catch(()=>({}));
      if(!authResponse.ok||!clientUser?.id) return reply(res,401,{ok:false,error:"Session client invalide. Reconnectez-vous."});
      if(action==="revision-quote"){
        const file=body.file||{}, name=safeStr(file.name,180), base64=String(file.base64||"");
        const tier=String(body.revisionTier||"standard");
        const tierLabels={essential:"Correction essentielle",standard:"Révision standard",deep:"Révision approfondie"};
        const marketRates={west_africa:{currency:"FCFA",rates:{essential:750,standard:1500,deep:2500}},africa_other:{currency:"FCFA",rates:{essential:1000,standard:1800,deep:3000}},fr_be:{currency:"EUR",rates:{essential:2,standard:3.5,deep:6}},canada:{currency:"CAD",rates:{essential:3,standard:5,deep:8}}};
        const countryCode=String(req.headers["x-vercel-ip-country"]||req.headers["cf-ipcountry"]||"").trim().toUpperCase();
        const westAfricaCountries=new Set(["BJ","CI","SN","TG","BF","ML","NE","GN","GW","MR"]);
        const market=countryCode==="FR"||countryCode==="BE" ? "fr_be" : countryCode==="CA" ? "canada" : westAfricaCountries.has(countryCode) ? "west_africa" : ["CD","CG","GA","CM","TD","MG","RW","BI"].includes(countryCode) ? "africa_other" : "";
        if(!Object.prototype.hasOwnProperty.call(tierLabels,tier)) return reply(res,400,{ok:false,error:"Niveau de révision invalide."});
        if(!name||!base64||base64.length>4000000||!/\.docx$/i.test(name)) return reply(res,400,{ok:false,error:"Joignez un document Word .docx de moins de 3 Mo."});
        let documentText="";
        try { const extracted=await mammoth.extractRawText({buffer:Buffer.from(base64,"base64")}); documentText=String(extracted.value||"").trim(); }
        catch { return reply(res,400,{ok:false,error:"Le fichier Word est illisible. Réexportez-le puis réessayez."}); }
        const wordCount=documentText?documentText.split(/\s+/).filter(Boolean).length:0;
        if(wordCount<1) return reply(res,400,{ok:false,error:"Aucun texte exploitable n’a été détecté dans le document."});
        if(!market) return reply(res,422,{ok:false,error:"Le devis ne peut pas être calculé pour ce marché pour le moment.",code:"COUNTRY_DETECTION_UNAVAILABLE"});
        const pages=Math.max(1,Math.ceil(wordCount/320)), marketInfo=marketRates[market], unitPrice=marketInfo.rates[tier], totalPrice=Math.round(unitPrice*pages*100)/100;
        const daysPer20={essential:2,standard:3,deep:5}, extraDays=Math.max(0,Math.ceil(pages/20)-1), minDays=daysPer20[tier]+extraDays, maxDays=minDays+1;
        return reply(res,200,{ok:true,estimatedPages:pages,detectedWordCount:wordCount,unitPrice,currency:marketInfo.currency,estimatedAmount:totalPrice,revisionTier:tier,tierLabel:tierLabels[tier],deliveryDays:{min:minDays,max:maxDays},deliveryLabel:minDays===maxDays?minDays+" jours ouvrés":minDays+" à "+maxDays+" jours ouvrés"});
      }
      if(action==="revision-submit"){
        const projectId=safeStr(body.projectId,80);
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) return reply(res,400,{ok:false,error:"Identifiant de projet invalide."});
        const member=await supabaseAdminRequest("/rest/v1/trimemo_client_projects?user_id=eq."+encodeURIComponent(clientUser.id)+"&project_id=eq."+encodeURIComponent(projectId)+"&select=project_id,subject&limit=1");
        if(!member.data?.length) return reply(res,403,{ok:false,error:"Ce document n’est pas associé à votre compte."});
        const rawInstructions=safeStr(body.instructions,8000), file=body.file||{}, name=safeStr(file.name,180), base64=String(file.base64||"");
        const tier=String(body.revisionTier||"standard");
        const tierLabels={essential:"Correction essentielle",standard:"Révision standard",deep:"Révision approfondie"};
        const marketRates={west_africa:{label:"Bénin et Afrique de l’Ouest francophone",currency:"FCFA",rates:{essential:750,standard:1500,deep:2500}},africa_other:{label:"Autres marchés africains francophones",currency:"FCFA",rates:{essential:1000,standard:1800,deep:3000}},fr_be:{label:"France et Belgique",currency:"EUR",rates:{essential:2,standard:3.5,deep:6}},canada:{label:"Canada francophone",currency:"CAD",rates:{essential:3,standard:5,deep:8}}};
        const countryCode=String(req.headers["x-vercel-ip-country"]||req.headers["cf-ipcountry"]||"").trim().toUpperCase();
        const westAfricaCountries=new Set(["BJ","CI","SN","TG","BF","ML","NE","GN","GW","MR"]);
        const market=countryCode==="FR"||countryCode==="BE" ? "fr_be" : countryCode==="CA" ? "canada" : westAfricaCountries.has(countryCode) ? "west_africa" : ["CD","CG","GA","CM","TD","MG","RW","BI"].includes(countryCode) ? "africa_other" : "";
        if(!Object.prototype.hasOwnProperty.call(tierLabels,tier)) return reply(res,400,{ok:false,error:"Niveau de révision invalide."});
        if(rawInstructions.length<10) return reply(res,400,{ok:false,error:"Précisez les corrections attendues (10 caractères minimum)."});
        if(!name||!base64||base64.length>4000000||!/\.docx$/i.test(name)) return reply(res,400,{ok:false,error:"Joignez le document Word .docx exporté depuis Trimémo, de moins de 3 Mo."});
        let documentText="";
        try {
          const buffer=Buffer.from(base64,"base64");
          const extracted=await mammoth.extractRawText({buffer});
          documentText=String(extracted.value||"").trim();
        } catch {
          return reply(res,400,{ok:false,error:"Le fichier Word est illisible. Réexportez le document depuis Trimémo puis réessayez."});
        }
        const wordCount=documentText?documentText.split(/\s+/).filter(Boolean).length:0;
        if(wordCount<1) return reply(res,400,{ok:false,error:"Aucun texte exploitable n’a été détecté dans le document Word."});
        const pages=Math.max(1,Math.ceil(wordCount/320));
        if(!market) return reply(res,422,{ok:false,error:"Le pays n’a pas pu être détecté automatiquement par le serveur. Réessayez depuis le site Trimémo.",code:"COUNTRY_DETECTION_UNAVAILABLE"});
        const marketInfo=marketRates[market], unitPrice=marketInfo.rates[tier], totalPrice=Math.round(unitPrice*pages*100)/100;
        const daysPer20={essential:2,standard:3,deep:5}, extraDays=Math.max(0,Math.ceil(pages/20)-1), minDays=daysPer20[tier]+extraDays, maxDays=minDays+1;\n        const quoteBlock="\\n\\n--- DEVIS INDICATIF DE RÉVISION HUMAINE ---\\nPrestation : "+tierLabels[tier]+"\\nVolume estimé : "+pages+" page(s)\\nTarif unitaire : "+unitPrice+" "+marketInfo.currency+" / page\\nEstimation : "+totalPrice+" "+marketInfo.currency+"\\nDélai estimé : "+minDays+" à "+maxDays+" jours ouvrés\\n--- FIN DU DEVIS ---";
        const instructions=rawInstructions+quoteBlock;
        const row={user_id:clientUser.id,project_id:projectId,client_email:safeStr(clientUser.email,254),document_title:safeStr(body.documentTitle||member.data[0].subject||"Document Trimémo",240),instructions,attachment_name:name,attachment_type:safeStr(file.type,120)||"application/octet-stream",attachment_base64:base64,status:"pending"};
        const created=await supabaseAdminRequest("/rest/v1/trimemo_human_revisions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(row)});
        const saved=created.data?.[0]||{};
        let emailSent=false; const emailKey=String(process.env.RESEND_API_KEY||"").trim(), to=String(process.env.TRIMEMO_REVISION_EMAIL||process.env.TRIMEMO_OWNER_EMAIL||"").trim();
        if(emailKey&&to){
          const origin=String(process.env.TRIMEMO_FRONTEND_URL||"https://trimemo-frontend.vercel.app").replace(/\/$/,"");
          const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
          const html="<h2>Nouvelle demande de révision humaine</h2><p><b>Document :</b> "+esc(row.document_title)+"</p><p><b>Client :</b> "+esc(row.client_email)+"</p><p><b>Consignes et devis indicatif :</b><br>"+esc(instructions).replace(/\n/g,"<br>")+"</p><p>Le document joint est disponible dans l’espace administrateur : <a href='"+origin+"/owner'>Ouvrir Trimémo Admin</a></p>";
          try { const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+emailKey,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.TRIMEMO_EMAIL_FROM||"Trimémo <onboarding@resend.dev>",to:[to],subject:"Nouvelle demande de révision : "+row.document_title,html}),signal:AbortSignal.timeout(10000)}); emailSent=sent.ok; } catch {}
        }
        return reply(res,201,{ok:true,request:{id:saved.id,status:saved.status,created_at:saved.created_at},emailSent,estimatedPages:pages,detectedWordCount:wordCount,estimatedAmount:totalPrice,currency:marketInfo.currency,deliveryDays:{min:minDays,max:maxDays},deliveryLabel:minDays+" à "+maxDays+" jours ouvrés",message:(emailSent?"Demande envoyée et notification e-mail transmise.":"Demande enregistrée. La notification e-mail doit être configurée côté serveur.")+" Volume analysé automatiquement : environ "+pages+" page(s)."});
      }
      if(action==="revision-client-list"){
        const rows=await supabaseAdminRequest("/rest/v1/trimemo_human_revisions?user_id=eq."+encodeURIComponent(clientUser.id)+"&select=id,project_id,document_title,status,admin_notes,delivery_name,created_at,updated_at,completed_at&order=created_at.desc&limit=200");
        return reply(res,200,{ok:true,requests:rows.data||[]});
      }
      const id=safeStr(body.id,30);if(!/^\d+$/.test(id))return reply(res,400,{ok:false,error:"Identifiant invalide."});
      const rows=await supabaseAdminRequest("/rest/v1/trimemo_human_revisions?user_id=eq."+encodeURIComponent(clientUser.id)+"&id=eq."+id+"&select=delivery_name,delivery_type,delivery_base64,status&limit=1");
      const item=rows.data?.[0];if(!item||item.status!=="completed"||!item.delivery_base64)return reply(res,404,{ok:false,error:"Le document corrigé n’est pas disponible."});
      return reply(res,200,{ok:true,name:item.delivery_name,type:item.delivery_type,base64:item.delivery_base64});
    }
    const owner = requireOwner(req);
    actor = safeStr(owner.sub || "owner", 254);
    if (action === "revisions") {
      const rows=await supabaseAdminRequest("/rest/v1/trimemo_human_revisions?select=id,user_id,project_id,client_email,document_title,instructions,attachment_name,attachment_type,status,admin_notes,delivery_name,created_at,updated_at,completed_at&order=created_at.desc&limit=500");
      return reply(res,200,{ok:true,requests:rows.data||[]});
    }
    if (action === "revision-file") {
      const id=safeStr(req.body?.id,30);if(!/^\d+$/.test(id))return reply(res,400,{ok:false,error:"Identifiant invalide."});
      const rows=await supabaseAdminRequest("/rest/v1/trimemo_human_revisions?id=eq."+id+"&select=attachment_name,attachment_type,attachment_base64,delivery_name,delivery_type,delivery_base64&limit=1");
      const item=rows.data?.[0];if(!item)return reply(res,404,{ok:false,error:"Demande introuvable."});
      const delivery=req.body?.delivery===true,base64=delivery?item.delivery_base64:item.attachment_base64;if(!base64)return reply(res,404,{ok:false,error:"Fichier indisponible."});
      return reply(res,200,{ok:true,name:delivery?item.delivery_name:item.attachment_name,type:delivery?item.delivery_type:item.attachment_type,base64});
    }
    if (action === "revision-update") {
      const id=safeStr(req.body?.id,30),status=safeStr(req.body?.status,30);
      if(!/^\d+$/.test(id)||!["pending","in_progress","completed"].includes(status))return reply(res,400,{ok:false,error:"Statut invalide."});
      const patch={status,admin_notes:safeStr(req.body?.adminNotes,5000),updated_at:new Date().toISOString()};
      if(status==="completed"){
        const file=req.body?.file||{},name=safeStr(file.name,180),base64=String(file.base64||"");
        if(!name||!base64||base64.length>4000000||! /\.(pdf|docx|doc|txt|rtf)$/i.test(name))return reply(res,400,{ok:false,error:"Joignez le document corrigé avant de terminer la demande."});
        patch.delivery_name=name;patch.delivery_type=safeStr(file.type,120)||"application/octet-stream";patch.delivery_base64=base64;patch.completed_at=new Date().toISOString();
      }
      const updated=await supabaseAdminRequest("/rest/v1/trimemo_human_revisions?id=eq."+id,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});
      const item=updated.data?.[0];
      let emailSent=false;
      if(status==="completed"&&item?.client_email&&process.env.RESEND_API_KEY){
        try {
          const origin=String(process.env.TRIMEMO_FRONTEND_URL||"https://trimemo-frontend.vercel.app").replace(/\/$/,"");
          const note=safeStr(patch.admin_notes,5000).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
          const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.TRIMEMO_EMAIL_FROM||"Trimémo <onboarding@resend.dev>",to:[item.client_email],subject:"Votre document corrigé est prêt - Trimémo",html:"<p>Votre document corrigé est disponible dans votre espace client Trimémo.</p><p><a href='"+origin+"'>Connectez-vous pour le récupérer.</a></p>"+(note?"<p>Note : "+note+"</p>":"")}),signal:AbortSignal.timeout(10000)});
          emailSent=sent.ok;
        } catch {}
      }
      return reply(res,200,{ok:true,request:item,emailSent,emailConfigured:Boolean(process.env.RESEND_API_KEY)});
    }

    if (action === "overview") {
      const [clients, projects, orderData, usageData, logs] = await Promise.all([
        loadClients(), loadProjects(), loadOrders(), loadUsage(),
        getAllRows("/rest/v1/trimemo_admin_logs?select=id,actor,category,severity,action,message,request_path,status_code,request_id,metadata,created_at&order=created_at.desc", 300, 300),
      ]);
      const allOrders = orderData.orders;
      return reply(res, 200, {
        ok: true,
        summary: { clients: clients.length, projects: projects.length, orders: allOrders.length,
          paidOrders: allOrders.filter(o => ["paid", "consumed"].includes(o.status)).length,
          pendingOrders: allOrders.filter(o => o.status === "pending").length,
          refundedOrders: allOrders.filter(o => o.status === "refunded" || o.refund_status === "refunded").length,
          activeProjects: projects.filter(p => p.progress_percent < 100).length,
          revenue: orderData.revenue, usage: usageData.summary, errorLogs: logs.filter(l => ["error", "critical"].includes(l.severity)).length },
        recentOrders: allOrders.slice(0, 8), recentProjects: projects.slice(0, 8),
        recentLogs: logs.slice(0, 10), usageByEndpoint: usageData.by_endpoint,
      });
    }
    if (action === "clients") return reply(res, 200, { ok: true, clients: await loadClients() });
    if (action === "projects") return reply(res, 200, { ok: true, projects: await loadProjects() });
    if (action === "orders") {
      const data = await loadOrders();
      return reply(res, 200, { ok: true, ...data });
    }
    if (action === "pricing") {
      const settings = await readAdminSettings({ strict: true });
      return reply(res, 200, { ok: true, settings });
    }
    if (action === "usage") return reply(res, 200, { ok: true, ...(await loadUsage()) });
    if (action === "logs") {
      const logs = await getAllRows("/rest/v1/trimemo_admin_logs?select=id,actor,category,severity,action,message,request_path,status_code,request_id,metadata,created_at&order=created_at.desc", 1000, 3000);
      return reply(res, 200, { ok: true, logs: logs.slice(0, 1000) });
    }
    if (action === "save-settings") {
      const validated = validateSettings(req.body || {});
      const settings = await writeAdminSettings({ ...validated, updated_by: actor });
      await logAdminEvent({ actor, category: "settings", severity: "warning", action: "settings_updated", message: "La grille tarifaire, les quotas ou les paramètres de coût OpenAI ont été modifiés." });
      return reply(res, 200, { ok: true, settings });
    }
    if (action === "update-client") {
      const clientId = safeStr(req.body?.clientId, 80);
      const access = req.body?.access === "suspended" ? "suspended" : "active";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) return reply(res, 400, { ok: false, error: "Identifiant client invalide." });
      const current = await authAdminRequest("/auth/v1/admin/users/" + encodeURIComponent(clientId));
      const user = current.user || current;
      const app_metadata = { ...(user.app_metadata || {}), trimemo_access: access };
      await authAdminRequest("/auth/v1/admin/users/" + encodeURIComponent(clientId), {
        method: "PUT",
        body: JSON.stringify({ app_metadata, ban_duration: access === "suspended" ? "876000h" : "none" }),
      });
      await logAdminEvent({ actor, category: "account", severity: "warning", action: access === "suspended" ? "client_suspended" : "client_restored", message: access === "suspended" ? "Accès client suspendu par l'administrateur." : "Accès client rétabli par l'administrateur.", metadata: { clientId } });
      return reply(res, 200, { ok: true, clientId, access });
    }
    if (action === "refund-order") {
      const orderId = safeStr(req.body?.orderId, 160);
      if (!orderId) return reply(res, 400, { ok: false, error: "Référence de commande absente." });
      const order = await refundOrder(orderId, actor);
      return reply(res, 200, { ok: true, order: { order_id: order?.order_id, status: order?.status, refund_status: order?.refund_status, refund_id: order?.refund_id, refund_amount: order?.refund_amount, refunded_at: order?.refunded_at } });
    }
    return reply(res, 400, { ok: false, error: "Action administrateur inconnue." });
  } catch (error) {
    const status = errorStatus(error);
    await logAdminEvent({ actor, category: "admin-api", severity: status >= 500 ? "error" : "warning", action: "admin_request_failed", message: safeStr(error?.message || "Erreur administrateur", 450), requestPath: "/api/admin-console", statusCode: status });
    return reply(res, status, { ok: false, error: status >= 500 ? "Opération administrateur impossible pour le moment." : safeStr(error?.message || "Requête invalide.", 300) });
  }
}
