import crypto from 'node:crypto';
import { setCors } from '../lib/http.js';
import { requireClientProject } from '../lib/client-project-auth.js';
import { verifyPricingQuote } from '../lib/pricing.js';
import { createPremiumToken } from '../lib/premium-auth.js';
import { normalizePreviewWordLimit } from './academic.js';
import { sandboxRepository } from '../lib/fedapay-sandbox-repository.js';
import { createSandboxPaymentFlow } from '../lib/fedapay-sandbox-flow.js';
import { rateLimit } from '../lib/rate-limit.js';
import { hydrateProjectFiles } from '../lib/project-file-store.js';

export default async function handler(req,res) {
  setCors(res,req,'POST, OPTIONS');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({error:'Méthode non autorisée.'});
  if(process.env.VERCEL_ENV!=='preview'||process.env.FEDAPAY_SANDBOX_ENABLED!=='true') return res.status(404).json({error:'Service indisponible.'});
  try {
    const key=String(process.env.FEDAPAY_SANDBOX_SECRET_KEY||'');
    const callbackUrl=String(process.env.FEDAPAY_SANDBOX_CALLBACK_URL||'');
    const repo=sandboxRepository({url:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,testProjectRef:process.env.FEDAPAY_SANDBOX_SUPABASE_REF});
    const flow=createSandboxPaymentFlow({repository:repo,key,callbackUrl});
    const action=String(req.body?.action||'');
    if(action==='create') {
      await rateLimit(req,'fedapay-sandbox-create',5,3600000);
      let project=req.body?.project||{};
      const projectId=String(project.projectId||project.project_id||'');
      const user=await requireClientProject(req,projectId);
      if(Array.isArray(project.files) && project.files.length) project=await hydrateProjectFiles(project);
      const quote=verifyPricingQuote(project.pricingQuoteToken,project);
      if(!quote) return res.status(400).json({error:'Relancez l’estimation du projet.'});
      const formula=String(project.formula||project.formule||'').toUpperCase();
      const preview=project.paidPreviewSnapshot;
      if(!String(project.sujet||'').trim()||!['LICENCE','MASTER','DOCTORAT'].includes(formula)||!preview?.problematic?.question||preview.problematic.id!==project.paymentProblematicId||!preview?.plan?.parts?.length||preview.plan.id!==project.paymentPlanId||!String(preview?.introduction?.content||'').trim()) return res.status(400).json({error:'Validez le projet, le plan et l’aperçu avant le paiement.'});
      project={...project,formula,paidPreviewSnapshot:normalizePreviewWordLimit(preview)};
      const result=await flow.begin({userId:String(user.id),projectId,reference:'trimemo_'+crypto.randomUUID(),project,quote});
      return res.status(200).json(result);
    }
    if(action==='verify') {
      await rateLimit(req,'fedapay-sandbox-verify',20,3600000);
      const providerId=String(req.body?.id||'');
      if(!/^\d{1,18}$/.test(providerId)) return res.status(400).json({error:'Référence de paiement invalide.'});
      const intent=await repo.findByProviderId(providerId);
      if(!intent) return res.status(403).json({error:'Commande indisponible.'});
      const user=await requireClientProject(req,intent.projectId);
      const result=await flow.verify({userId:String(user.id),providerId});
      if(result.status!=='PAID') return res.status(202).json({status:'PENDING',error:'Paiement en cours de confirmation.'});
      return res.status(200).json({...result,premium_token:createPremiumToken(result.project,result.order_id),preview:result.project?.paidPreviewSnapshot||null});
    }
    return res.status(404).json({error:'Action inconnue.'});
  } catch(error) {
    console.error('FEDAPAY_SANDBOX_ERROR',{code:String(error?.code||error?.name||'ERROR'),status:Number(error?.status)||500});
    const status=Number(error?.status)||500;
    return res.status(status).json({error:status<500?error.message:'Le service de paiement de test est indisponible.'});
  }
}
