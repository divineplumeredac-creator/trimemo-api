import { sandboxEnabled, publicSandboxEnabled } from '../lib/fedapay-sandbox-config.js';
import { sandboxRepository } from '../lib/fedapay-sandbox-repository.js';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'||!sandboxEnabled()) return res.status(404).json({error:'Indisponible.'});
 try {
  sandboxRepository({url:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,testProjectRef:process.env.FEDAPAY_SANDBOX_SUPABASE_REF,publicSite:publicSandboxEnabled()});
  const key=String(process.env.FEDAPAY_SANDBOX_SECRET_KEY||'');
  if(!key.startsWith('sk_sandbox')) throw Error('sandbox key required');
  const base=String(process.env.SUPABASE_URL).replace(/\/$/,'');
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const results=await Promise.all([
   fetch(base+'/rest/v1/trimemo_payment_intents?select=reference&limit=1',{headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey},signal:AbortSignal.timeout(8000)}),
   fetch('https://sandbox-api.fedapay.com/v1/transactions/search',{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(8000)})
  ]);
  const database=results[0].ok?'ok':'unavailable',fedapay=results[1].ok?'ok':'unavailable';
  return res.status(database==='ok'&&fedapay==='ok'?200:503).json({test_only:true,database,fedapay});
 } catch {return res.status(503).json({test_only:true,status:'unavailable'});}
}
