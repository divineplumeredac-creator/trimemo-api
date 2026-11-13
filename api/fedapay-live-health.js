export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');
if(req.method!=='GET')return res.status(405).end();
if(process.env.FEDAPAY_ENV!=='live')return res.status(404).end();
const key=String(process.env.FEDAPAY_LIVE_SECRET_KEY||'');
try{
const r=await fetch('https://api.fedapay.com/v1/transactions/search',{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
const data=await r.json().catch(()=>({}));
const raw=typeof data.message==='string'?data.message:typeof data.error==='string'?data.error:'';
const message=raw.length<220&&!raw.includes(key)&&!raw.includes('@')&&!/sk_|pk_|Bearer/i.test(raw)?raw:'';
return res.status(200).json({mode:'live',provider_status:r.status,credentials_accepted:r.ok,message});
}catch{return res.status(503).json({mode:'live',error:'provider_unreachable'});}
}