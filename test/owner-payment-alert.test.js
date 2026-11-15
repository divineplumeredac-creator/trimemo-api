import test from "node:test";
import assert from "node:assert/strict";
import { paymentNotification, notifyOwnerPayment } from "../lib/owner-payment-alert.js";

const envKeys=["VERCEL_ENV","PAYPAL_ENV","FEDAPAY_ENV","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RESEND_API_KEY","TRIMEMO_EMAIL_FROM","TRIMEMO_REVISION_EMAIL"];
const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
function env(){Object.assign(process.env,{VERCEL_ENV:"production",PAYPAL_ENV:"live",FEDAPAY_ENV:"live",SUPABASE_URL:"https://db.example.invalid",SUPABASE_SERVICE_ROLE_KEY:"secret",RESEND_API_KEY:"test-key",TRIMEMO_EMAIL_FROM:"Trimémo <notifications@trimemo-redac.company>",TRIMEMO_REVISION_EMAIL:"owner@example.invalid"});}
function restore(){for(const key of envKeys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
const order={order_id:"PAYPAL-123",project_id:"p1",status:"paid",amount:"15.00",currency:"EUR",paid_at:"2026-11-15T12:00:00.000Z",project_snapshot:{sujet:"Recherche <important>"},owner_id:null};
test("e-mail commercial professionnel et échappement du document",()=>{
 const mail=paymentNotification(order,"paypal","customer@example.invalid");
 assert.match(mail.subject,/15.00 EUR/);
 assert.match(mail.text,/PayPal/);
 assert.match(mail.html,/Recherche &lt;important&gt;/);
 assert.doesNotMatch(mail.html,/<important>/);
});
test("paiement confirmé: notification unique Resend",async()=>{
 env();
 const real=globalThis.fetch,log={events:0,mails:[],headers:[]};
 globalThis.fetch=async(url,init={})=>{
  const u=String(url);
  if(u.includes("/trimemo_orders?"))return Response.json([order]);
  if(u.includes("/trimemo_client_projects?"))return Response.json([{user_id:"11111111-2222-4333-8444-555555555555"}]);
  if(u.includes("/auth/v1/admin/users/"))return Response.json({email:"buyer@example.invalid"});
  if(u.includes("/trimemo_owner_email_events?")&&init.method==="POST")return Response.json(++log.events===1?[{event_key:"payment:PAYPAL-123"}]:[]);
  if(u.includes("/trimemo_owner_email_events?")&&init.method==="PATCH")return Response.json([]);
  if(u==="https://api.resend.com/emails"){log.mails.push(JSON.parse(init.body));log.headers.push(init.headers);return Response.json({id:"send_1"});}
  throw Error("unexpected "+u);
 };
 try{
  assert.equal((await notifyOwnerPayment("PAYPAL-123","paypal")).status,"accepted");
  assert.equal((await notifyOwnerPayment("PAYPAL-123","paypal")).status,"duplicate");
  assert.equal(log.mails.length,1);
  assert.equal(log.mails[0].to[0],"owner@example.invalid");
  assert.match(log.mails[0].text,/buyer@example.invalid/);
  assert.match(log.headers[0]["Idempotency-Key"],/^trimemo-sale-/);
 }finally{globalThis.fetch=real;restore();}
});
test("capture sandbox: aucune notification",async()=>{
 env();process.env.PAYPAL_ENV="sandbox";
 const real=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error("sandbox must not send");};
 try{assert.equal((await notifyOwnerPayment("PAYPAL-123","paypal")).status,"skipped");}finally{globalThis.fetch=real;restore();}
});
test("transaction en attente: aucun e-mail",async()=>{
 env();const real=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  if(String(url).includes("/trimemo_orders?"))return Response.json([{...order,status:"pending",paid_at:null}]);
  throw Error("should not send");
 };
 try{assert.equal((await notifyOwnerPayment("PAYPAL-123","paypal")).status,"not_paid");}finally{globalThis.fetch=real;restore();}
});
