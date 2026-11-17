import crypto from 'node:crypto';
import { supabaseAdminRequest, supabaseAdminConfig } from './admin-data.js';

const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const endpoints = new Set(['estimation','problematique','plan','redaction','apercu']);

// Install only after server-side account and project ownership have been verified.
export function trackProjectFailures(res, user, project, stage) {
  const projectId = String(project?.projectId || project?.project_id || '');
  if (!uuid(user?.id) || !uuid(projectId) || !endpoints.has(stage)) return;
  const send = res.json.bind(res);
  res.json = async payload => {
    if (Number(res.statusCode) >= 500) {
      try {
        await supabaseAdminRequest('/rest/v1/trimemo_project_incidents', {
          method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({project_id: projectId, user_id: user.id, stage})
        });
      } catch (e) { console.error('INCIDENT_RECORD_FAILED', {code: String(e?.code || e?.name || 'ERROR')}); }
    }
    return send(payload);
  };
}

export async function notifyResolvedIncident(id) {
  if (!uuid(id)) throw Object.assign(new Error('Incident invalide.'), {status:400});
  if (process.env.VERCEL_ENV !== 'production') throw Object.assign(new Error('Envoi disponible uniquement en production.'), {status:403});
  const key=String(process.env.RESEND_API_KEY||'').trim(), from=String(process.env.TRIMEMO_EMAIL_FROM||'').trim();
  if (!key || !from || /onboarding@resend\.dev/i.test(from)) throw Object.assign(new Error('Le service d’e-mail doit être configuré avec une adresse de domaine vérifiée.'), {status:503});
  const claimed=await supabaseAdminRequest('/rest/v1/trimemo_project_incidents?id=eq.'+id+'&status=in.(open,failed)&select=*', {
    method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify({status:'sending',updated_at:new Date().toISOString()})
  });
  const row=claimed.data?.[0];
  if (!row) throw Object.assign(new Error('Incident déjà traité ou en cours de traitement.'), {status:409});
  try {
    const {url,key:service}=supabaseAdminConfig();
    const member=await supabaseAdminRequest('/rest/v1/trimemo_client_projects?project_id=eq.'+encodeURIComponent(row.project_id)+'&user_id=eq.'+encodeURIComponent(row.user_id)+'&select=project_id&limit=1');
    if (!member.data?.length) throw new Error('projet_inaccessible');
    const userRes=await fetch(url+'/auth/v1/admin/users/'+encodeURIComponent(row.user_id),{headers:{apikey:service,Authorization:'Bearer '+service},signal:AbortSignal.timeout(8000)});
    const data=await userRes.json().catch(()=>({})); const user=data?.user||data;
    const to=String(user?.email||'').trim();
    if(!userRes.ok || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !user.email_confirmed_at || user?.app_metadata?.trimemo_access==='suspended') throw new Error('compte_inaccessible');
    const subject='La panne est résolue, reprenez votre projet';
    const text='Bonjour,\n\nVous avez récemment rencontré une difficulté lors de l’utilisation de Trimémo en raison d’une panne technique.\n\nLa panne est maintenant résolue. Nous vous invitons à vous reconnecter à votre espace client pour reprendre votre projet et réessayer.\n\nAccéder à mon espace client : https://trimemo-redac.company\n\nSi la difficulté persiste, vous pouvez nous contacter depuis votre espace client. Nous serons heureux de vous accompagner.\n\nMerci pour votre compréhension et votre confiance.\n\nL’équipe Trimémo';
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'trimemo-incident-'+crypto.createHash('sha256').update(id).digest('hex')},body:JSON.stringify({from,to:[to],subject,text}),signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('email_'+response.status);
    const result=await response.json().catch(()=>({}));
    await supabaseAdminRequest('/rest/v1/trimemo_project_incidents?id=eq.'+id+'&status=eq.sending',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'sent',provider_message_id:String(result.id||'').slice(0,150),updated_at:new Date().toISOString()})});
    return {status:'sent'};
  } catch(e) {
    await supabaseAdminRequest('/rest/v1/trimemo_project_incidents?id=eq.'+id+'&status=eq.sending',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'failed',error_code:String(e?.message||'error').slice(0,80),updated_at:new Date().toISOString()})}).catch(()=>{});
    throw Object.assign(new Error('La notification n’a pas pu être confirmée. Vérifiez la configuration et réessayez.'),{status:502});
  }
}
