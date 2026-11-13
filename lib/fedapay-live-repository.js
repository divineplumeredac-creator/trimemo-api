import { publicLiveEnabled } from './fedapay-live-config.js';
import { projectFingerprint } from './premium-auth.js';
const error = (message,status=503) => Object.assign(new Error(message),{status});

// Preview uses an isolated database; the public live uses existing client projects.
export function liveRepository({ url, serviceKey, testProjectRef, publicSite = false }) {
  let parsed; try { parsed=new URL(url); } catch { throw error('Base de test non configurée.'); }
  const expectedRef = publicSite && publicLiveEnabled() ? 'myzaepudoqnqnvpbopoy' : String(testProjectRef || '');
  if (parsed.protocol !== 'https:' || !/^[a-z0-9]{20}$/.test(expectedRef) || parsed.hostname !== `${expectedRef}.supabase.co` || (expectedRef === 'myzaepudoqnqnvpbopoy' && !(publicSite && publicLiveEnabled())) || !serviceKey) throw error('Une base Supabase isolée est obligatoire pour les tests FedaPay.');
  const base=parsed.origin+'/rest/v1/';
  async function call(path, options={}) {
    let res;
    try { res=await fetch(base+path,{...options,headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})},signal:AbortSignal.timeout(8000)}); }
    catch { throw error('Registre de test indisponible.'); }
    if (res.status===409) throw error('Une autre tentative existe pour ce projet. Reprenez-la ou contactez le support.',409);
    if (!res.ok) throw error('Registre de test indisponible.');
    return res.json().catch(()=>null);
  }
  const where = (reference, providerId) => `reference=eq.${encodeURIComponent(reference)}${providerId ? `&provider_id=eq.${encodeURIComponent(providerId)}` : ''}`;
  const fromRow = r => r && ({reference:r.reference,userId:r.user_id,projectId:r.project_id,provider:r.provider,providerId:r.provider_id,amount:Number(r.amount),currency:r.currency,project:r.project_snapshot,state:r.state});
  return {
    async reserve({userId,projectId,reference,project,amount,currency,provider}) {
      const { documentContext, ...safeProject }=project;
      safeProject.files=(Array.isArray(project.files)?project.files:[]).map(f=>({name:String(f?.name||''),type:String(f?.type||''),category:String(f?.category||''),content:''}));
      const rows=await call('trimemo_live_payment_intents',{method:'POST',body:JSON.stringify({reference,project_id:projectId,user_id:userId,provider,amount,currency,project_snapshot:safeProject})});
      if (!Array.isArray(rows)||rows.length!==1) throw error('La réservation de test a échoué.');
      return fromRow(rows[0]);
    },
    async attachProviderId({reference,providerId}) {
      const rows=await call(`trimemo_live_payment_intents?${where(reference)}&state=eq.creating&provider_id=is.null`,{method:'PATCH',body:JSON.stringify({provider_id:providerId})});
      if(!Array.isArray(rows)||rows.length!==1) throw error('La référence de paiement ne peut pas être enregistrée.');
    },
    async markReady({reference,providerId}) {
      const rows=await call(`trimemo_live_payment_intents?${where(reference,providerId)}&state=eq.creating`,{method:'PATCH',body:JSON.stringify({state:'ready'})});
      if(!Array.isArray(rows)||rows.length!==1) throw error('La tentative de paiement est en cours de vérification.');
    },
    async findByProviderId(providerId) {
      const rows=await call(`trimemo_live_payment_intents?provider=eq.fedapay&provider_id=eq.${encodeURIComponent(providerId)}&limit=1`);
      if(!Array.isArray(rows)) throw error('Registre de test indisponible.');
      return fromRow(rows[0]);
    },
    async confirmApproved({reference,providerId,userId,projectId,amount,currency}) {
      const intent=await this.findByProviderId(providerId);
      if(!intent || intent.reference!==reference || intent.userId!==userId || intent.projectId!==projectId) throw error('Commande de test invalide.',403);
      const data=await call('rpc/confirm_trimemo_fedapay_live',{method:'POST',body:JSON.stringify({p_reference:reference,p_provider_id:providerId,p_user_id:userId,p_project_id:projectId,p_amount:amount,p_currency:currency,p_fingerprint:projectFingerprint(intent.project)})});
      if(!data || data.status!=='PAID' || !data.order_id || !data.project) throw error('La confirmation de test a échoué.');
      return data;
    },
  };
}
