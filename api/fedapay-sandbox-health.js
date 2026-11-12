// Diagnostic de disponibilité limité à la version protégée de test.
export default async function handler(req,res) {
  if(req.method!=='GET' || process.env.VERCEL_ENV!=='preview' || process.env.FEDAPAY_SANDBOX_ENABLED!=='true') return res.status(404).json({error:'Indisponible.'});
  const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const ref=String(process.env.FEDAPAY_SANDBOX_SUPABASE_REF||'');
  if(!/^[a-z0-9]{20}$/.test(ref)||ref==='myzaepudoqnqnvpbopoy'||base!==`https://${ref}.supabase.co`) return res.status(503).json({test_only:true,database:'isolation_failed',fedapay:'not_tested'});
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
  const feda=String(process.env.FEDAPAY_SANDBOX_SECRET_KEY||'');
  async function check(url,headers){try {const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});if(response.ok)return 'ok';if(response.status===401||response.status===403)return 'credentials_rejected';const ct=response.headers.get('content-type')||'';const body=(await response.text()).slice(0,2000).toLowerCase();const hints=['unauthorized','auth','token','key','parameter','bad request','access','forbidden','account','transaction','customer','error','rate','limit','query','page','invalid','validation','expired','missing','environment','version','disabled','secret','public','sandbox','live','not found','no transaction','no transactions','aucun','aucune','introuvable','empty','nothing','vide','rien','created','none'].filter(word=>body.includes(word));let keys=[],errors=[],message='';try{const obj=JSON.parse(body);keys=Object.keys(obj).filter(k=>/^[a-z_]{1,30}$/.test(k)).slice(0,8);errors=Object.keys(obj.errors||{}).filter(k=>/^[a-z_]{1,30}$/.test(k)).slice(0,8);const m=typeof obj.message==='string'?obj.message.trim():'';if(m.length<=120 && /^[a-zà-ÿ .,:;!?'-]+$/u.test(m) && !m.includes('secret')) message=m}catch{}return `http_${response.status}:${ct.includes('json')?'json':'other'}:${hints.join(',')||'no_hints'}:fields_${keys.join(',')}:errors_${errors.join(',')}:message_${message||'none'}`;}catch(error){return error?.name==='TimeoutError'?'timeout':'network_error';}}
  const [database,fedapay,customers,currencies]=await Promise.all([
    key ? check(`${base}/rest/v1/trimemo_orders?select=order_id&limit=0`,{apikey:key,Authorization:`Bearer ${key}`}) : 'missing',
    feda ? check('https://sandbox-api.fedapay.com/v1/transactions',{Authorization:`Bearer ${feda}`,Accept:'application/json'}) : 'missing',
    feda ? check('https://sandbox-api.fedapay.com/v1/customers?per_page=1',{Authorization:`Bearer ${feda}`,Accept:'application/json'}) : 'missing',
    feda ? check('https://sandbox-api.fedapay.com/v1/currencies?per_page=1',{Authorization:`Bearer ${feda}`,Accept:'application/json'}) : 'missing',
  ]);
  return res.status(database==='ok'&&fedapay==='ok'?200:503).json({test_only:true,database,fedapay,customers,currencies,key_format:feda.startsWith('sk_sandbox')?'sandbox_secret':feda.startsWith('pk_')?'public_key':feda.startsWith('sk_live')?'live_secret':'other'});
}
