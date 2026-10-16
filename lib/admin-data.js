const DEFAULT = { pricing_config: { markets: {
africa:{currency:"XOF",label:"Afrique francophone",rates:{devoir:150,rapport:200,memoire:250,article:300,these:300}},
europe:{currency:"EUR",label:"Europe",rates:{devoir:0.4,rapport:0.6,memoire:0.8,article:1,these:1.3}},
northAmerica:{currency:"USD",label:"Canada / États-Unis",rates:{devoir:0.5,rapport:0.75,memoire:1,article:1.25,these:1.6}},
international:{currency:"USD",label:"Marché international",rates:{devoir:0.5,rapport:0.75,memoire:1,article:1.25,these:1.6}}
},levelCoefficients:{licence:1,master:1.15,doctorat:1.4},complexityCoefficients:{faible:0.9,moyenne:1,elevee:1.2}},
quotas:{maxProblematicGenerations:3,maxPlanGenerations:3,freePreviewWords:300,wordsPerPage:320,maxPages:300},
usage_costs:{inputUsdPerMillion:null,outputUsdPerMillion:null} };
export function supabaseAdminConfig(){
 const url=String(process.env.SUPABASE_URL||"").trim().replace(/\/$/,"");
 const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!url||!key){const e=new Error("Service Supabase administrateur non configuré.");e.status=503;throw e;}
 return {url,key};
}
export async function supabaseAdminRequest(path,init={}){
 const {url,key}=supabaseAdminConfig();
 const response=await fetch(url+path,{...init,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(10000)});
 const raw=await response.text();let data=[];
 try{data=raw?JSON.parse(raw):[]}catch{}
 if(!response.ok){const e=new Error(String(data?.message||data?.msg||data?.error||"Opération Supabase impossible.").slice(0,300));e.status=response.status;throw e;}
 return {data,headers:response.headers};
}
export function defaultAdminSettings(){return JSON.parse(JSON.stringify(DEFAULT));}
export async function readAdminSettings({strict=false}={}){
 try{
  const result=await supabaseAdminRequest("/rest/v1/trimemo_admin_settings?id=eq.main&select=id,pricing_config,quotas,usage_costs,updated_at,updated_by&limit=1");
  const row=Array.isArray(result.data)?result.data[0]:null;
  if(!row){if(strict)throw new Error("Configuration administrateur absente.");return defaultAdminSettings();}
  return {...defaultAdminSettings(),...row,
   pricing_config:{...DEFAULT.pricing_config,...(row.pricing_config||{})},
   quotas:{...DEFAULT.quotas,...(row.quotas||{})},
   usage_costs:{...DEFAULT.usage_costs,...(row.usage_costs||{})}};
 }catch(e){if(strict)throw e;return defaultAdminSettings();}
}
export async function writeAdminSettings({pricing_config,quotas,usage_costs,updated_by}){
 const row={id:"main",pricing_config,quotas,usage_costs,updated_by:String(updated_by||"owner").slice(0,254),updated_at:new Date().toISOString()};
 const result=await supabaseAdminRequest("/rest/v1/trimemo_admin_settings?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(row)});
 return Array.isArray(result.data)?result.data[0]:row;
}
