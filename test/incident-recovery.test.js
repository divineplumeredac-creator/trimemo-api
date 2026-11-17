import test from 'node:test';
import assert from 'node:assert/strict';
import {trackProjectFailures, notifyResolvedIncident} from '../lib/incident-recovery.js';
const project='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222', id='33333333-3333-4333-8333-333333333333';
test('seules les erreurs serveur de projets authentifiés sont consignées', async()=>{
 process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SERVICE_ROLE_KEY='secret';
 const old=global.fetch;const calls=[];global.fetch=async (url,opts)=>{calls.push({url,opts});return new Response('',{status:201})};
 try { let res={statusCode:500,json(x){return x}}; trackProjectFailures(res,{id:user},{projectId:project},'estimation');await res.json({error:'failure'});assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].opts.body).user_id,user);
 res={statusCode:429,json(x){return x}};trackProjectFailures(res,{id:user},{projectId:project},'estimation');await res.json({});assert.equal(calls.length,1);
 res={statusCode:500,json(x){return x}};trackProjectFailures(res,null,{projectId:project},'estimation');await res.json({});assert.equal(calls.length,1);
 } finally{global.fetch=old}
});
test('la notification est adressée au propriétaire vérifié et protégée contre les doublons',async()=>{
 process.env.VERCEL_ENV='production';process.env.RESEND_API_KEY='test';process.env.TRIMEMO_EMAIL_FROM='Trimémo <contact@example.org>';
 const old=global.fetch;const calls=[];global.fetch=async(url,opts)=>{calls.push({url:String(url),opts});if(String(url).includes('trimemo_project_incidents')&&opts.method==='PATCH'&&opts.headers.Prefer==='return=representation')return Response.json([{id,project_id:project,user_id:user}]);if(String(url).includes('trimemo_client_projects'))return Response.json([{project_id:project}]);if(String(url).includes('/auth/v1/admin/users/'))return Response.json({email:'client@example.org',email_confirmed_at:'2026-01-01T00:00:00Z'});if(String(url).includes('api.resend.com'))return Response.json({id:'email-1'});return new Response(null,{status:204})};
 try{const result=await notifyResolvedIncident(id);assert.equal(result.status,'sent');const sent=calls.find(c=>c.url.includes('api.resend.com'));assert.deepEqual(JSON.parse(sent.opts.body).to,['client@example.org']);assert.match(JSON.parse(sent.opts.body).text,/panne est maintenant résolue/);assert.match(sent.opts.headers['Idempotency-Key'],/^trimemo-incident-/)}finally{global.fetch=old}
});
test('un incident déjà traité ne provoque aucun nouvel envoi',async()=>{
 process.env.VERCEL_ENV='production';process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SERVICE_ROLE_KEY='secret';process.env.RESEND_API_KEY='test';process.env.TRIMEMO_EMAIL_FROM='Trimémo <contact@example.org>';
 const old=global.fetch;let calls=[];global.fetch=async(url)=>{calls.push(String(url));return Response.json([])};
 try{await assert.rejects(()=>notifyResolvedIncident(id),e=>e.status===409);assert.equal(calls.some(url=>url.includes('api.resend.com')),false)}finally{global.fetch=old}
});
