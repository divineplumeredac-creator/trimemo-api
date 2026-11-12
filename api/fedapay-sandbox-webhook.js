import { sandboxEnabled, publicSandboxEnabled } from '../lib/fedapay-sandbox-config.js';
import { verifySandboxWebhook } from '../lib/fedapay-sandbox.js';
import { sandboxRepository } from '../lib/fedapay-sandbox-repository.js';
import { createSandboxPaymentFlow } from '../lib/fedapay-sandbox-flow.js';

export default async function handler(req,res) {
  if(req.method!=='POST') return res.status(405).end();
  if(!sandboxEnabled()) return res.status(404).end();
  try {
    const chunks=[]; let size=0;
    for await (const chunk of req) { size+=chunk.length; if(size>65536) return res.status(413).end(); chunks.push(Buffer.from(chunk)); }
    const raw=Buffer.concat(chunks);
    if(!verifySandboxWebhook(raw,String(req.headers['x-fedapay-signature']||''),String(process.env.FEDAPAY_SANDBOX_WEBHOOK_SECRET||''))) return res.status(401).end();
    let event; try { event=JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
    if(event?.name!=='transaction.approved') return res.status(200).end();
    let entity=event.entity;
    if(typeof entity==='string') { try { entity=JSON.parse(entity); } catch { return res.status(400).end(); } }
    const providerId=String(entity?.id||'');
    if(!/^\d{1,18}$/.test(providerId) || (typeof entity?.id==='number' && !Number.isSafeInteger(entity.id))) return res.status(400).end();
    const repo=sandboxRepository({url:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,testProjectRef:process.env.FEDAPAY_SANDBOX_SUPABASE_REF,publicSite:publicSandboxEnabled()});
    const intent=await repo.findByProviderId(providerId);
    // Retry until a concurrent creation has durably saved its provider id.
    if(!intent) return res.status(503).end();
    const flow=createSandboxPaymentFlow({repository:repo,key:process.env.FEDAPAY_SANDBOX_SECRET_KEY,callbackUrl:process.env.FEDAPAY_SANDBOX_CALLBACK_URL});
    const result=await flow.verify({userId:intent.userId,providerId});
    if(result.status!=='PAID') return res.status(503).end();
    return res.status(200).end();
  } catch(error) {
    console.error('FEDAPAY_SANDBOX_WEBHOOK_ERROR',{code:String(error?.code||error?.name||'ERROR')});
    return res.status(503).end();
  }
}
