import crypto from 'node:crypto';
import { setCors } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { requireOwner } from '../lib/owner-auth.js';
import { notifyAmbassadorDecision } from '../lib/ambassador-notification.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const trim=(value,max=200)=>String(value??'').trim().slice(0,max);
const projectPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codePattern=/^AMB[A-F0-9]{8}$/;
const ACTIVE_LIMIT=10;

function settings(){
 const url=trim(process.env.SUPABASE_URL,400).replace(/\/$/,'');
 const key=trim(process.env.SUPABASE_SERVICE_ROLE_KEY,1000);
 if(!url||!key)throw fail(503,'Le programme ambassadeurs est temporairement indisponible.');
 return {url,key};
}
async function db(path,init={}){
 const {url,key}=settings();
 let res;
 try{res=await fetch(url+'/rest/v1/'+path,{...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation',...(init.headers||{})},signal:AbortSignal.timeout(10000)});}
 catch{throw fail(503,'Le programme ambassadeurs est momentanément indisponible.');}
 const data=await res.json().catch(()=>null);
 if(!res.ok){
  console.error('TRIMEMO_AMBASSADOR_DB_ERROR',{status:res.status,code:String(data?.code||'DATABASE_ERROR')});
  throw fail(res.status===409||res.status===400?409:503,res.status===409||res.status===400?'Ce changement ne peut pas être enregistré. Vérifiez les places disponibles ou les informations fournies.':'Le programme ambassadeurs est temporairement indisponible.');
 }
 return data;
}
async function client(req){
 const bearer=/^Bearer\s+(.+)$/i.exec(trim(req.headers?.authorization||req.headers?.Authorization,5000));
 if(!bearer)throw fail(401,'Connectez-vous à Trimémo avant de continuer.');
 const {url,key}=settings();
 const res=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+bearer[1]},signal:AbortSignal.timeout(8000)});
 const user=await res.json().catch(()=>null);
 if(!res.ok||!user?.id)throw fail(401,'Votre session a expiré. Reconnectez-vous.');
 if(user.app_metadata?.trimemo_access==='suspended'||(user.banned_until&&Date.parse(user.banned_until)>Date.now()))throw fail(403,'Ce compte est suspendu.');
 if(!user.email_confirmed_at)throw fail(403,'Confirmez votre adresse e-mail avant de demander votre adhésion.');
 return user;
}
const selectAmbassador='id,user_id,full_name,university,city,whatsapp,motivation,referral_code,status,commission_rate,created_at,approved_at';
const selectCommission='order_id,ambassador_id,sale_amount,currency,commission_amount,status,created_at,paid_at,payout_reference';

async function findMine(userId){
 const rows=await db('trimemo_ambassadors?user_id=eq.'+encodeURIComponent(userId)+'&select='+selectAmbassador+'&limit=1');
 return Array.isArray(rows)?rows[0]||null:null;
}
function publicMine(row){
 if(!row)return null;
 const {user_id,whatsapp,motivation,...safe}=row;
 return {...safe, referral_code:row.status==='active'?row.referral_code:null};
}

async function adminAction(action,body,req){
 requireOwner(req);
 if(action==='admin-list'){
  const [ambassadors,referrals,commissions]=await Promise.all([
   db('trimemo_ambassadors?select='+selectAmbassador+'&order=created_at.desc&limit=300'),
   db('trimemo_affiliate_referrals?select=project_id,ambassador_id,created_at&order=created_at.desc&limit=500'),
   db('trimemo_affiliate_commissions?select='+selectCommission+'&order=created_at.desc&limit=500')
  ]);
  return {ok:true,limit:ACTIVE_LIMIT,rate:10,ambassadors,referrals,commissions};
 }
 if(action==='admin-decision'){
  const id=trim(body.id,80),status=trim(body.status,20);
  if(!projectPattern.test(id)||!['active','rejected','suspended'].includes(status))throw fail(400,'Décision invalide.');
  const rows=await db('trimemo_ambassadors?id=eq.'+encodeURIComponent(id)+'&select='+selectAmbassador+'&limit=1');
  if(!Array.isArray(rows)||rows.length!==1)throw fail(404,'Candidature introuvable.');
  const previous=rows[0];
  if(previous.status===status)return {ok:true,ambassador:previous,changed:false,notification:{status:'unchanged',message:'Décision déjà enregistrée : aucun nouvel e-mail envoyé.'}};
  if(previous.status==='rejected'&&status==='suspended')throw fail(400,'Décision incompatible.');
  // Verrouillage optimiste : un double clic ne produit pas deux notifications.
  const updated=await db('trimemo_ambassadors?id=eq.'+encodeURIComponent(id)+'&status=eq.'+encodeURIComponent(previous.status),{
   method:'PATCH',body:JSON.stringify({status})
  });
  if(!Array.isArray(updated)||updated.length!==1)throw fail(409,'Cette candidature a changé. Actualisez la liste.');
  const notification=['active','rejected'].includes(status)
   ? await notifyAmbassadorDecision(updated[0])
   : {status:'unchanged',message:'Statut mis à jour.'};
  return {ok:true,ambassador:updated[0],changed:true,notification};
 }
 if(action==='admin-resend-notification'){
  // Renvoi uniquement sur demande explicite de l’administrateur.
  await rateLimit(req,'ambassador-resend',10,3600000);
  const id=trim(body.id,80);
  if(!projectPattern.test(id))throw fail(400,'Candidature invalide.');
  const rows=await db('trimemo_ambassadors?id=eq.'+encodeURIComponent(id)+'&select='+selectAmbassador+'&limit=1');
  if(!Array.isArray(rows)||rows.length!==1)throw fail(404,'Candidature introuvable.');
  if(!['active','rejected'].includes(rows[0].status))throw fail(409,'Aucune décision à notifier.');
  return {ok:true,ambassador:rows[0],changed:false,notification:await notifyAmbassadorDecision(rows[0])};
 }
 if(action==='admin-payout'){
  const orderId=trim(body.orderId,180), reference=trim(body.reference,120);
  if(!orderId||reference.length<6)throw fail(400,'Indiquez la référence du virement déjà effectué (6 caractères minimum).');
  const rows=await db('trimemo_affiliate_commissions?order_id=eq.'+encodeURIComponent(orderId)+'&select='+selectCommission+'&limit=1');
  const c=rows?.[0];
  if(!c||c.status!=='pending')throw fail(409,'Cette commission ne peut pas être payée.');
  // Délai de 14 jours pour laisser le temps aux remboursements d'être enregistrés.
  if(Date.now()-Date.parse(c.created_at)<14*24*3600*1000)throw fail(409,'Le délai de vérification de 14 jours n’est pas terminé.');
  const order=(await db('trimemo_orders?order_id=eq.'+encodeURIComponent(orderId)+'&select=order_id,status,refund_status&limit=1'))?.[0];
  if(!order||!['paid','consumed'].includes(order.status)||order.refund_status!=='none')throw fail(409,'Commande non confirmée ou remboursement détecté.');
  const updated=await db('trimemo_affiliate_commissions?order_id=eq.'+encodeURIComponent(orderId)+'&status=eq.pending',{
   method:'PATCH',body:JSON.stringify({status:'paid',paid_at:new Date().toISOString(),payout_reference:reference})
  });
  if(!Array.isArray(updated)||updated.length!==1)throw fail(409,'Cette commission a changé. Actualisez la liste.');
  return {ok:true,commission:updated[0]};
 }
 throw fail(400,'Action administrateur inconnue.');
}
export default async function handler(req,res){
 setCors(res,req,'POST, OPTIONS');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Méthode non autorisée.'});
 try{
  const body=req.body||{},action=trim(body.action,40);
  if(action.startsWith('admin-')){
   await rateLimit(req,'ambassador-admin',90,3600000);
   return res.status(200).json(await adminAction(action,body,req));
  }
  await rateLimit(req,action==='apply'?'ambassador-apply':'ambassador-client',action==='apply'?5:60,3600000);
  const user=await client(req);
  if(action==='apply'){
   const name=trim(body.fullName,120),university=trim(body.university,180),
    city=trim(body.city,100),whatsapp=trim(body.whatsapp,25),motivation=trim(body.motivation,1200);
   if(!body.consent)throw fail(400,'Vous devez accepter les conditions du programme.');
   if(name.length<3||university.length<2||city.length<2||!/^[+0-9][0-9\s().-]{6,24}$/.test(whatsapp))throw fail(400,'Vérifiez votre nom, votre établissement, votre ville et votre numéro WhatsApp.');
   if(await findMine(user.id))throw fail(409,'Votre candidature existe déjà. Consultez son statut dans cet espace.');
   const referralCode='AMB'+crypto.randomBytes(4).toString('hex').toUpperCase();
   const created=await db('trimemo_ambassadors?on_conflict=user_id',{
    method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:JSON.stringify({user_id:user.id,full_name:name,university,city,whatsapp,motivation,referral_code:referralCode,status:'pending'})
   });
   if(!Array.isArray(created)||created.length!==1)throw fail(409,'Une candidature existe déjà pour ce compte.');
   return res.status(200).json({ok:true,ambassador:publicMine(created[0]),message:'Candidature reçue. Elle sera examinée par l’équipe Trimémo.'});
  }
  if(action==='me'){
   const row=await findMine(user.id);
   if(!row)return res.status(200).json({ok:true,ambassador:null});
   if(row.status!=='active')return res.status(200).json({ok:true,ambassador:publicMine(row),referralCount:0,commissions:[]});
   const [refs,commissions]=await Promise.all([
    db('trimemo_affiliate_referrals?ambassador_id=eq.'+encodeURIComponent(row.id)+'&select=project_id&limit=500'),
    db('trimemo_affiliate_commissions?ambassador_id=eq.'+encodeURIComponent(row.id)+'&select=sale_amount,currency,commission_amount,status,created_at,paid_at&order=created_at.desc&limit=200')
   ]);
   return res.status(200).json({ok:true,ambassador:publicMine(row),referralCount:refs.length,commissions});
  }
  if(action==='attribute'){
   const projectId=trim(body.projectId,100),referral=trim(body.code,20).toUpperCase();
   if(!projectPattern.test(projectId)||!codePattern.test(referral))throw fail(400,'Référence de parrainage invalide.');
   const [membership,ambassadors]=await Promise.all([
    db('trimemo_client_projects?project_id=eq.'+encodeURIComponent(projectId)+'&user_id=eq.'+encodeURIComponent(user.id)+'&select=project_id,created_at&limit=1'),
    db('trimemo_ambassadors?referral_code=eq.'+encodeURIComponent(referral)+'&status=eq.active&select=id,user_id,approved_at&limit=1')
   ]);
   if(membership.length!==1)throw fail(403,'Ce projet ne correspond pas à votre compte.');
   // La commission récompense une acquisition réelle : on n'attribue pas
   // rétroactivement des projets créés avant le clic ambassadeur.
   const created=Date.parse(String(membership[0].created_at||''));
   if(!Number.isFinite(created)||Date.now()-created>15*60*1000||created>Date.now()+60000)
    throw fail(409,'Le parrainage doit être enregistré au moment de créer un nouveau projet.');
   const ambassador=ambassadors?.[0];
   if(!ambassador)throw fail(404,'Ce lien ambassadeur n’est pas actif.');
   if(ambassador.user_id===user.id)throw fail(403,'Vous ne pouvez pas parrainer votre propre projet.');
   const existing=await db('trimemo_affiliate_referrals?project_id=eq.'+encodeURIComponent(projectId)+'&select=ambassador_id&limit=1');
   if(existing.length)return res.status(200).json({ok:true,attributed:existing[0].ambassador_id===ambassador.id});
   const [orders,intents]=await Promise.all([
    db('trimemo_orders?project_id=eq.'+encodeURIComponent(projectId)+'&select=order_id&limit=1'),
    db('trimemo_live_payment_intents?project_id=eq.'+encodeURIComponent(projectId)+'&select=reference&limit=1')
   ]);
   if(orders.length||intents.length)throw fail(409,'Le parrainage doit être attribué avant de commencer le paiement.');
   const rows=await db('trimemo_affiliate_referrals?on_conflict=project_id',{
    method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:JSON.stringify({project_id:projectId,ambassador_id:ambassador.id,client_user_id:user.id})
   });
   return res.status(200).json({ok:true,attributed:Array.isArray(rows)&&rows.length===1});
  }
  throw fail(400,'Action inconnue.');
 }catch(e){
  const status=Number(e?.status)||500;
  console.error('TRIMEMO_AMBASSADORS_API',{action:String(req.body?.action||'').slice(0,35),status,code:String(e?.code||e?.name||'ERROR')});
  return res.status(status).json({ok:false,error:status>=500?'Le programme ambassadeurs est momentanément indisponible. Réessayez plus tard.':String(e.message||'Requête invalide.').slice(0,240)});
 }
}
