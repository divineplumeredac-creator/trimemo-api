import { publicLiveEnabled } from './fedapay-live-config.js';
import crypto from 'node:crypto';

// Live adapter: never accepts sandbox credentials.
const BASE = 'https://api.fedapay.com/v1';
const fail = (message, status=502) => Object.assign(new Error(message),{status});
const safeId = value => (typeof value !== 'number' || Number.isSafeInteger(value)) && /^\d{1,18}$/.test(String(value || ''));
const objectOf = (body, type) => body?.[`v1/${type}`] || body;

async function request(path, {key, method='GET', body}={}) {
  if (!key || typeof key !== 'string' || /\s/u.test(key) || !key.startsWith('sk_live')) throw fail('La clé FedaPay live est absente ou invalide.',503);
  let response;
  try {
    response = await fetch(BASE+path,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(15000)});
  } catch { throw fail('Le service FedaPay live est indisponible.'); }
  const data = await response.json().catch(()=>null);
  if (!response.ok) {
    const error = fail("FedaPay live a refusé la requête (HTTP " + response.status + "). Vérifiez la validation du compte marchand et sa configuration.");
    error.code = "FEDAPAY_LIVE_HTTP_" + response.status;
    const detail = [data?.errors?.amount].flat(2).filter(v=>typeof v==="string"&&v.length<250&&!/sk_|pk_|@|Bearer/i.test(v)).join(" ");
    if(detail) { error.message = "FedaPay refuse le montant : " + detail; error.publicMessage = error.message; }
    console.error("FEDAPAY_LIVE_AMOUNT_VALIDATION", {status:response.status,detail:detail||"not_provided"});
    console.error("FEDAPAY_LIVE_PROVIDER_REJECTED", {status:response.status, operation:method+" "+path, fields:Object.keys(data?.errors||{}).filter(k=>/^[a-z_]{1,40}$/.test(k))});
    throw error;
  }
  if (!data || typeof data !== 'object') throw fail('Réponse FedaPay live invalide.');
  return data;
}

export async function createLiveTransaction({key, amount, reference, callbackUrl, customer}) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) throw fail('Montant live invalide.',400);
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(reference || ''))) throw fail('Référence live invalide.',400);
  let callback;try {callback=new URL(callbackUrl)} catch {throw fail('Adresse de retour invalide.',400)}
  const previewCallback = callback.hostname.startsWith('trimemo-frontend-') && callback.hostname.endsWith('.vercel.app');
  const publicCallback = publicLiveEnabled() && ['https://trimemo-redac.company', 'https://trimemo-frontend.vercel.app'].includes(callback.origin);
  if (callback.protocol !== 'https:' || !publicCallback || callback.username || callback.password || callback.port) throw fail('Adresse de retour non autorisée.',400);
  const data=await request('/transactions',{key,method:'POST',body:{description:'Projet académique Trimémo',amount,currency:{iso:'XOF'},callback_url:callback.href,merchant_reference:reference,custom_metadata:{trimemo_reference:reference},...(customer?.email ? {customer:{email:String(customer.email),...(customer.firstname?{firstname:String(customer.firstname)}:{}),...(customer.lastname?{lastname:String(customer.lastname)}:{})}} : {})}});
  const tx=objectOf(data,'transaction');
  if (!safeId(tx?.id) || Number(tx.amount)!==amount || !['pending','created'].includes(String(tx.status).toLowerCase())) throw fail('Réponse de création FedaPay inattendue.');
  return {id:String(tx.id),status:String(tx.status),amount};
}

export async function livePaymentLink({key, transactionId}) {
  if (!safeId(transactionId)) throw fail('Identifiant FedaPay invalide.',400);
  const result=await request(`/transactions/${transactionId}/token`,{key,method:'POST'});
  let link;try {link=new URL(result.url)} catch {throw fail('Lien FedaPay invalide.')}
  const host=link.hostname.toLowerCase();
  if (link.protocol!=='https:' || link.username || link.password || link.port || !(host==='fedapay.com'||host.endsWith('.fedapay.com')||host==='fpay.li')) throw fail('Lien de paiement FedaPay non reconnu.');
  return link.href;
}

export async function liveTransaction({key,transactionId}) {
  if (!safeId(transactionId)) throw fail('Identifiant FedaPay invalide.',400);
  const data=await request(`/transactions/${transactionId}?include=currency`,{key});
  const tx=objectOf(data,'transaction');
  if (String(tx?.id)!==String(transactionId) || !Number.isSafeInteger(Number(tx.amount))) throw fail('Transaction FedaPay incohérente.');
  if (!tx.currency?.iso && !tx.currency_iso && safeId(tx.currency_id)) {
    const currency=objectOf(await request(`/currencies/${tx.currency_id}`,{key}),'currency');
    if (String(currency?.id)!==String(tx.currency_id) || !currency?.iso) throw fail('Devise FedaPay non vérifiable.');
    return {...tx,currency:{iso:String(currency.iso)}};
  }
  return tx;
}

export function validateLivePayment(transaction, {id,amount,reference,currency,allowTerminal=false}) {
  const metadata=transaction?.custom_metadata || transaction?.metadata || {};
  const providerReference=transaction?.merchant_reference || metadata.trimemo_reference;
  const actualCurrency=transaction?.currency?.iso || transaction?.currency_iso;
  if (String(transaction?.id)!==String(id) || Number(transaction?.amount)!==amount || String(providerReference)!==String(reference) || String(actualCurrency || '').toUpperCase()!==String(currency).toUpperCase()) throw fail('Le paiement ne correspond pas à la commande.',403);
  if (transaction?.refunded_at || String(transaction?.status).toLowerCase()==='refunded') throw fail('Le paiement ne peut pas être utilisé.',403);
  if (['canceled','cancelled','declined','failed'].includes(String(transaction?.status).toLowerCase())) {
    if (allowTerminal) return false; // Identity, amount, reference and currency were checked above.
    throw fail('Le paiement ne peut pas être utilisé.',403);
  }
  return String(transaction?.status).toLowerCase()==='approved';
}

// Follow the provider's documented t=<timestamp>,s=<HMAC-SHA256> header and
// reject stale/future timestamps. Caller must pass the exact raw bytes.
export function verifyLiveWebhook(raw,header,secret,now=Math.floor(Date.now()/1000)) {
  if (!Buffer.isBuffer(raw) || typeof header!=='string' || typeof secret!=='string' || !secret) return false;
  const fields=header.split(',').map(s=>s.trim().split('='));
  const timestamps=fields.filter(([k])=>k==='t');
  if (timestamps.length!==1 || !/^\d{1,12}$/.test(timestamps[0][1]||'')) return false;
  const timestamp=Number(timestamps[0][1]);
  if (Math.abs(now-timestamp)>300) return false;
  const expected=crypto.createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest();
  return fields.filter(([k,v])=>k==='s' && /^[0-9a-f]{64}$/i.test(v||'')).some(([,v])=>crypto.timingSafeEqual(Buffer.from(v,'hex'),expected));
}
