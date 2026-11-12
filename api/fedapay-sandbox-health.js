// Diagnostic de disponibilité limité à la version protégée de test.
export default async function handler(req,res) {
  if(req.method!=='GET' || process.env.VERCEL_ENV!=='preview' || process.env.FEDAPAY_SANDBOX_ENABLED!=='true') return res.status(404).json({error:'Indisponible.'});
  const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const ref=String(process.env.FEDAPAY_SANDBOX_SUPABASE_REF||'');
  if(!/^[a-z0-9]{20}$/.test(ref)||ref==='myzaepudoqnqnvpbopoy'||base!==`https://${ref}.supabase.co`) return res.status(503).json({test_only:true,database:'isolation_failed',fedapay:'not_tested'});
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
  const feda=String(process.env.FEDAPAY_SANDBOX_SECRET_KEY||'');
  async function check(url,headers){try {const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});return response.ok?'ok':response.status===401||response.status===403?'credentials_rejected':'unavailable';}catch{return 'unavailable';}}
  const [database,fedapay]=await Promise.all([
    key ? check(`${base}/rest/v1/trimemo_orders?select=order_id&limit=0`,{apikey:key,Authorization:`Bearer ${key}`}) : 'missing',
    feda ? check('https://sandbox-api.fedapay.com/v1/transactions?per_page=1',{Authorization:`Bearer ${feda}`,Accept:'application/json'}) : 'missing',
  ]);
  return res.status(database==='ok'&&fedapay==='ok'?200:503).json({test_only:true,database,fedapay});
}
