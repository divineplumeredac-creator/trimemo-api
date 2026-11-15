import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ambassadors.js';
import {decisionEmail} from '../lib/ambassador-notification.js';
import {createOwnerToken} from '../lib/owner-auth.js';

const id='11111111-2222-4333-8444-555555555555';
const userId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
process.env.NODE_ENV='test';
process.env.TRIMEMO_OWNER_EMAIL='owner@example.invalid';
process.env.TRIMEMO_OWNER_AUTH_SECRET='synthetic-secret';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.RESEND_API_KEY='test-key';
process.env.TRIMEMO_EMAIL_FROM='Trimémo <notifications@example.test>';
const res=()=>({setHeader(){},status(c){this.code=c;return this},json(v){this.body=v;return this},end(){return this}});
const req=(action,extra={})=>({method:'POST',headers:{authorization:'Bearer '+createOwnerToken('owner@example.invalid')},body:{action,...extra}});
function mock(initial='pending',providerStatus=200){
 const original=globalThis.fetch,logs={status:initial,patches:0,mails:[],lookups:0};
 globalThis.fetch=async(u,o={})=>{
  const url=String(u);
  if(url.includes('/rest/v1/trimemo_ambassadors?')){
   if(o.method==='PATCH'){
    logs.patches++;
    const expected=new URL(url).searchParams.get('status')?.replace(/^eq\./,'');
    if(expected!==logs.status)return Response.json([]);
    logs.status=JSON.parse(o.body).status;
   }
   return Response.json([{id,user_id:userId,full_name:'Ana <Test>',referral_code:'AMB12345678',status:logs.status}]);
  }
  if(url.includes('/auth/v1/admin/users/')){logs.lookups++;return Response.json({id:userId,email:'candidate@example.invalid'});}
  if(url==='https://api.resend.com/emails'){logs.mails.push(JSON.parse(o.body));return Response.json(providerStatus===200?{id:'sent'}:{message:'error'},{status:providerStatus});}
  throw Error('Unexpected request '+url);
 };
 return {logs,restore:()=>{globalThis.fetch=original}};
}
test('approbation: le candidat reçoit une notification depuis le compte confirmé',async()=>{
 const {logs,restore}=mock();try{
 const out=res();await handler(req('admin-decision',{id,status:'active'}),out);
 assert.equal(out.code,200);assert.equal(out.body.notification.status,'accepted');
 assert.equal(logs.patches,1);assert.equal(logs.lookups,1);assert.equal(logs.mails.length,1);
 assert.deepEqual(logs.mails[0].to,['candidate@example.invalid']);
 assert.match(logs.mails[0].subject,/acceptée/);
 assert.match(logs.mails[0].html,/10 %/);
 assert.match(logs.mails[0].html,/Ana &lt;Test&gt;/);
 }finally{restore()}
});
test('refus: formulation respectueuse et aucune information de parrainage',async()=>{
 const {logs,restore}=mock();try{
 const out=res();await handler(req('admin-decision',{id,status:'rejected'}),out);
 assert.equal(out.code,200);assert.equal(out.body.notification.status,'accepted');
 assert.match(logs.mails[0].text,/n’a pas été retenue/);
 assert.doesNotMatch(logs.mails[0].text,/AMB12345678/);
 }finally{restore()}
});
test('décision inchangée: aucune notification supplémentaire',async()=>{
 const {logs,restore}=mock('active');try{
 const out=res();await handler(req('admin-decision',{id,status:'active'}),out);
 assert.equal(out.body.changed,false);assert.equal(logs.patches,0);assert.equal(logs.mails.length,0);
 }finally{restore()}
});
test('panne du prestataire : la décision reste enregistrée et le renvoi reste possible',async()=>{
 const {logs,restore}=mock('pending',422);try{
 const out=res();await handler(req('admin-decision',{id,status:'rejected'}),out);
 assert.equal(out.body.notification.status,'failed');assert.equal(out.body.ambassador.status,'rejected');
 const retry=res();await handler(req('admin-resend-notification',{id}),retry);
 assert.equal(retry.body.notification.status,'failed');
 assert.equal(logs.patches,1);assert.equal(logs.mails.length,2);
 }finally{restore()}
});
test('une adresse expéditrice absente rend le défaut visible sans bloquer la décision',async()=>{
 const saved=process.env.TRIMEMO_EMAIL_FROM;delete process.env.TRIMEMO_EMAIL_FROM;
 const {logs,restore}=mock();try{
 const out=res();await handler(req('admin-decision',{id,status:'active'}),out);
 assert.equal(out.body.notification.status,'unconfigured');assert.equal(logs.mails.length,0);
 }finally{restore();process.env.TRIMEMO_EMAIL_FROM=saved}
});
test('sécurité HTML: le nom est échappé',()=>{
 const mail=decisionEmail({full_name:'<script>alert(1)</script>',status:'rejected'});
 assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);
});
