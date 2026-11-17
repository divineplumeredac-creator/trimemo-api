import test from 'node:test';import assert from 'node:assert/strict';
import {classifyFollowup} from '../api/admin-console.js';import {followupMessage,validOptout,signOptout} from '../lib/followup-email.js';
const id='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const base={membership:{project_id:id,user_id:user,created_at:'2026-11-16T08:00:00Z',updated_at:'2026-11-16T09:00:00Z',payment_status:'draft'},state:{updated_at:'2026-11-16T09:00:00Z',state:{blocks:[]}},orders:[],incidents:[],reminders:[],optouts:[],now:Date.parse('2026-11-19T09:00:00Z')};
test('sépare projets non payés et commandes réelles inachevées',()=>{
 assert.equal(classifyFollowup(base).kind,'unpaid');
 const paid={...base,orders:[{project_id:id,order_id:'fedapay-live:abc',status:'paid',paid_at:'2026-11-16T08:00:00Z'}]};assert.equal(classifyFollowup(paid).kind,'paid_incomplete');
 assert.equal(classifyFollowup({...paid,state:{...base.state,state:{blocks:[{status:'done',content:'texte'}]}}}),null);
 assert.equal(classifyFollowup({...paid,orders:[{...paid.orders[0],order_id:'fedapay-sandbox:test'}]}),null);
});
test('exclut les projets récents, incidents, désabonnements et rappels déjà envoyés',()=>{
 assert.equal(classifyFollowup({...base,now:Date.parse('2026-11-17T09:00:00Z')}),null);
 assert.equal(classifyFollowup({...base,orders:[{project_id:id,status:'pending'}]}),null);
 assert.equal(classifyFollowup({...base,incidents:[{project_id:id,status:'open'}]}),null);
 assert.equal(classifyFollowup({...base,optouts:[{user_id:user}]}),null);
 assert.equal(classifyFollowup({...base,reminders:[{project_id:id,kind:'unpaid'}]}),null);
});
test('messages distincts et lien de désinscription signé',()=>{
 process.env.SUPABASE_URL='https://example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='secret';
 assert.match(followupMessage('unpaid',user).subject,/projet vous attend/i);assert.match(followupMessage('paid_incomplete',user).text,/paiement/);assert.ok(validOptout(user,signOptout(user)));assert.equal(validOptout(user,'a'.repeat(64)),false);
});
test('envoi distinct au client vérifié et blocage des doublons',async()=>{
 const {sendFollowup}=await import('../lib/followup-email.js');process.env.VERCEL_ENV='production';process.env.RESEND_API_KEY='key';process.env.TRIMEMO_EMAIL_FROM='Trimémo <contact@example.org>';
 const old=global.fetch;let sent=0,claimed=false;global.fetch=async(url,opts)=>{
  if(String(url).includes('trimemo_followup_messages')&&opts.method==='POST'){if(claimed)return Response.json([]);claimed=true;return Response.json([{project_id:id}])}
  if(String(url).includes('/auth/v1/admin/users/'))return Response.json({email:'client@example.org',email_confirmed_at:'2026-11-16T00:00:00Z'});
  if(String(url).includes('api.resend.com')){sent++;assert.equal(JSON.parse(opts.body).to[0],'client@example.org');assert.match(JSON.parse(opts.body).text,/paiement/);return Response.json({id:'mail-1'})}
  return new Response(null,{status:204});};
 try{let row={project_id:id,user_id:user,kind:'paid_incomplete'};assert.equal((await sendFollowup(row)).status,'sent');await assert.rejects(()=>sendFollowup(row),e=>e.status===409);assert.equal(sent,1)}finally{global.fetch=old}
});
