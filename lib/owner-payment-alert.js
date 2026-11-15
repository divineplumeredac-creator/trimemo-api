import crypto from "node:crypto";
const clean=(v,max=300)=>String(v??"").trim().slice(0,max);
const esc=v=>clean(v,4000).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const adminUrl="https://trimemo-redac.company/owner";

export function paymentNotification(order,provider,customerEmail="") {
  const method=provider==="paypal"?"PayPal":"FedaPay / Mobile Money";
  const snap=order.project_snapshot||{};
  const title=clean(snap.sujet||snap.subject||snap.titre||"Document Trimémo",240);
  const amount=clean(order.amount,60)+" "+clean(order.currency,12);
  const paidAt=order.paid_at&&!Number.isNaN(Date.parse(order.paid_at))
    ?new Date(order.paid_at).toLocaleString("fr-FR",{timeZone:"Africa/Porto-Novo",dateStyle:"medium",timeStyle:"short"}):"";
  const details=[
    ["Montant",amount],["Moyen de paiement",method],["Document",title],
    ["Client",clean(customerEmail,254)||"Consulter l’espace administrateur"],
    ["Référence",clean(order.order_id,160)],["Projet",clean(order.project_id,100)],
    ["Date",paidAt],
  ];
  const subject="Trimémo — Nouveau paiement confirmé : "+amount;
  const text=["Nouvelle vente confirmée",...details.map(([key,value])=>key+" : "+value),
    "Paiement confirmé par le prestataire et enregistré dans Trimémo.",
    "Administration : "+adminUrl].join("\n\n");
  const rows=details.map(([key,value])=>'<tr><th style="border-bottom:1px solid #e4eee9;padding:11px;text-align:left;color:#1b4d3e;vertical-align:top">'+esc(key)+'</th><td style="border-bottom:1px solid #e4eee9;padding:11px;color:#29483b;word-break:break-word">'+esc(value)+'</td></tr>').join("");
  const html='<!doctype html><html lang="fr"><body style="background:#f4f8f6;margin:0;font-family:Arial,sans-serif">'
    +'<main style="max-width:630px;margin:25px auto;background:white;border-radius:12px;overflow:hidden">'
    +'<header style="background:#1b4d3e;color:white;padding:25px"><strong style="font-size:25px">Trimémo</strong><p>Notification administrateur</p></header>'
    +'<section style="padding:25px"><h1 style="font-size:22px;color:#1b4d3e">Nouvelle vente confirmée</h1>'
    +'<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px">'+rows+'</table>'
    +'<p style="color:#315747;font-size:14px">Le paiement a été vérifié et enregistré dans Trimémo.</p>'
    +'<p><a href="'+adminUrl+'" style="display:inline-block;background:#1b4d3e;color:white;padding:13px 18px;border-radius:7px;text-decoration:none">Consulter le tableau de bord</a></p>'
    +'</section></main></body></html>';
  return {subject,text,html};
}

async function sbRequest(path,options={}) {
  const base=clean(process.env.SUPABASE_URL,500).replace(/\/$/,"");
  const secret=clean(process.env.SUPABASE_SERVICE_ROLE_KEY,1500);
  if(!base||!secret) throw new Error("supabase_not_configured");
  const response=await fetch(base+"/rest/v1/"+path,{
    ...options,headers:{apikey:secret,Authorization:"Bearer "+secret,"Content-Type":"application/json",...(options.headers||{})},
    signal:AbortSignal.timeout(10000),
  });
  if(!response.ok) throw new Error("database_"+response.status);
  return response.json().catch(()=>[]);
}

async function customerEmail(order) {
  try {
    let uid=clean(order.owner_id,80);
    if(!uid){
      const rows=await sbRequest("trimemo_client_projects?project_id=eq."+encodeURIComponent(order.project_id)+"&select=user_id&limit=1");
      uid=clean(rows?.[0]?.user_id,80);
    }
    if(!/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(uid))return "";
    const base=clean(process.env.SUPABASE_URL,500).replace(/\/$/,"");
    const key=clean(process.env.SUPABASE_SERVICE_ROLE_KEY,1500);
    const response=await fetch(base+"/auth/v1/admin/users/"+encodeURIComponent(uid),{
      headers:{apikey:key,Authorization:"Bearer "+key},signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)return "";
    const data=await response.json().catch(()=>({}));
    return clean(data?.user?.email||data?.email,254);
  }catch{return "";}
}

export async function notifyOwnerPayment(orderId,provider) {
  if(!["paypal","fedapay"].includes(provider))return {status:"invalid"};
  // Do not inform the merchant about sandbox captures or preview transactions.
  if(process.env.VERCEL_ENV!=="production"||
     (provider==="paypal"&&process.env.PAYPAL_ENV!=="live")||
     (provider==="fedapay"&&process.env.FEDAPAY_ENV!=="live"))return {status:"skipped"};
  const key=clean(process.env.RESEND_API_KEY,1000);
  const from=clean(process.env.TRIMEMO_EMAIL_FROM,254);
  const to=clean(process.env.TRIMEMO_REVISION_EMAIL||process.env.TRIMEMO_OWNER_EMAIL,254);
  if(!key||!from||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){
    console.error("OWNER_PAYMENT_ALERT_UNCONFIGURED");
    return {status:"unconfigured"};
  }
  let claimed=false, eventKey="";
  try{
    const rows=await sbRequest("trimemo_orders?order_id=eq."+encodeURIComponent(orderId)
      +"&select=order_id,project_id,owner_id,status,amount,currency,paid_at,project_snapshot,refund_status&limit=1");
    const order=rows?.[0];
    if(!order||!["paid","consumed"].includes(order.status)||!order.paid_at
       ||(order.refund_status&&order.refund_status!=="none"))return {status:"not_paid"};
    if(provider==="fedapay"&&!String(order.order_id).startsWith("fedapay-live:"))return {status:"invalid"};
    eventKey="payment:"+clean(order.order_id,160);
    const inserted=await sbRequest("trimemo_owner_email_events?on_conflict=event_key",{
      method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
      body:JSON.stringify({event_key:eventKey,status:"reserved",recipient:to}),
    });
    claimed=Array.isArray(inserted)&&inserted.length===1;
    if(!claimed)return {status:"duplicate"};
    const email=paymentNotification(order,provider,await customerEmail(order));
    const idempotency="trimemo-sale-"+crypto.createHash("sha256").update(eventKey).digest("hex");
    const sent=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+key,"Idempotency-Key":idempotency},
      body:JSON.stringify({from,to:[to],...email}),signal:AbortSignal.timeout(12000),
    });
    if(!sent.ok)throw new Error("resend_"+sent.status);
    const result=await sent.json().catch(()=>({}));
    try{
      await sbRequest("trimemo_owner_email_events?event_key=eq."+encodeURIComponent(eventKey),{
        method:"PATCH",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({status:"accepted",provider_message_id:clean(result.id,150),updated_at:new Date().toISOString()}),
      });
    }catch(error){console.error("OWNER_PAYMENT_ALERT_RECEIPT_ERROR",{code:clean(error?.message,60)});}
    return {status:"accepted"};
  }catch(error){
    if(claimed)await sbRequest("trimemo_owner_email_events?event_key=eq."+encodeURIComponent(eventKey),{
      method:"PATCH",headers:{Prefer:"return=minimal"},
      body:JSON.stringify({status:"failed",error_code:clean(error?.message,90),updated_at:new Date().toISOString()}),
    }).catch(()=>null);
    console.error("OWNER_PAYMENT_ALERT_FAILED",{code:clean(error?.message||"error",90)});
    return {status:"failed"};
  }
}
