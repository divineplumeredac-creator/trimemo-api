import crypto from 'node:crypto';
import { supabaseAdminRequest, supabaseAdminConfig } from './admin-data.js';
const uidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function signOptout(userId){return crypto.createHmac('sha256',supabaseAdminConfig().key).update('trimemo-followup-optout:'+userId).digest('hex')}
export function validOptout(userId,sig){if(!uidPattern.test(String(userId))||!/^[a-f0-9]{64}$/.test(String(sig||'')))return false;return crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signOptout(userId),'hex'))}
export function followupMessage(kind,userId){
 const unsubscribe='https://trimemo-api.vercel.app/api/followup-unsubscribe?u='+encodeURIComponent(userId)+'&s='+signOptout(userId);
 const foot='\n\nPour ne plus recevoir ces rappels : '+unsubscribe;
 if(kind==='unpaid')return {subject:'Votre projet vous attend sur Trimémo',text:'Bonjour,\n\nVous avez commencé un projet sur Trimémo, mais vous ne l’avez pas encore poursuivi.\n\nVotre projet vous attend dans votre espace client. Vous pouvez vous reconnecter pour continuer à votre rythme : présentez votre sujet, choisissez votre problématique et votre plan, puis avancez progressivement dans votre rédaction.\n\nReprendre mon projet : https://trimemo-redac.company\n\nVous avez une question ou besoin d’aide ? Contactez-nous depuis votre espace client.\n\nÀ bientôt sur Trimémo,\n\nL’équipe Trimémo'+foot};
 if(kind==='paid_incomplete')return {subject:'Continuez la rédaction de votre projet sur Trimémo',text:'Bonjour,\n\nVous avez déjà effectué votre paiement pour votre projet sur Trimémo, mais votre document n’est pas encore terminé.\n\nReconnectez-vous à votre espace client pour retrouver votre projet et poursuivre votre rédaction là où vous vous êtes arrêté.\n\nContinuer ma rédaction : https://trimemo-redac.company\n\nSi vous rencontrez une difficulté ou avez besoin d’accompagnement, contactez-nous depuis votre espace client.\n\nMerci pour votre confiance.\n\nL’équipe Trimémo'+foot};
 throw new Error('Type de rappel invalide.');
}
export async function sendFollowup(row){
 if(process.env.VERCEL_ENV!=='production')throw Object.assign(new Error('Envoi disponible uniquement en production.'),{status:403});
 const key=String(process.env.RESEND_API_KEY||'').trim(),from=String(process.env.TRIMEMO_EMAIL_FROM||'').trim();
 if(!key||!from||/onboarding@resend\.dev/i.test(from))throw Object.assign(new Error('Service e-mail non configuré.'),{status:503});
 const q='/rest/v1/trimemo_followup_messages';
 const created=await supabaseAdminRequest(q+'?on_conflict=project_id,kind',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({project_id:row.project_id,user_id:row.user_id,kind:row.kind,status:'sending'})});
 if(!created.data?.length)throw Object.assign(new Error('Un rappel a déjà été traité pour ce projet et cette situation.'),{status:409});
 try{
  const {url,key:service}=supabaseAdminConfig();const u=await fetch(url+'/auth/v1/admin/users/'+encodeURIComponent(row.user_id),{headers:{apikey:service,Authorization:'Bearer '+service},signal:AbortSignal.timeout(8000)});const data=await u.json().catch(()=>({}));const user=data?.user||data;const to=String(user?.email||'').trim();
  if(!u.ok||!user.email_confirmed_at||user?.app_metadata?.trimemo_access==='suspended'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('compte_inaccessible');
  const idempotency=crypto.createHash('sha256').update(row.project_id+':'+row.kind).digest('hex');
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'trimemo-followup-'+idempotency},body:JSON.stringify({from,to:[to],...followupMessage(row.kind,row.user_id)}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('email_'+response.status);const result=await response.json().catch(()=>({}));
  await supabaseAdminRequest(q+'?project_id=eq.'+row.project_id+'&kind=eq.'+row.kind,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'sent',provider_message_id:String(result.id||'').slice(0,150),updated_at:new Date().toISOString()})});return {status:'sent'};
 }catch(e){await supabaseAdminRequest(q+'?project_id=eq.'+row.project_id+'&kind=eq.'+row.kind,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'failed',error_code:String(e?.message||'error').slice(0,80),updated_at:new Date().toISOString()})}).catch(()=>{});throw Object.assign(new Error('L’envoi du rappel n’a pas pu être confirmé.'),{status:502});}
}
