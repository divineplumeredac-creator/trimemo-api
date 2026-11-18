const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const stages = new Set(['preparation','writing_search','writing','verification','finalisation']);
function config() {
 const url=String(process.env.UPSTASH_REDIS_REST_URL||'').trim().replace(/\/$/,'');
 const token=String(process.env.UPSTASH_REDIS_REST_TOKEN||'').trim();
 if(!/^https:\/\//.test(url)||!token) return null;
 return {url,token};
}
function key(projectId,runId){return `trimemo:writing-progress:${projectId}:${runId}`;}
async function command(parts){const c=config();if(!c)return null;const response=await fetch(c.url,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(parts),signal:AbortSignal.timeout(1500)});if(!response.ok)throw Error('progress unavailable');const data=await response.json();if(data.error)throw Error('progress unavailable');return data.result;}
export async function setWritingProgress(projectId,runId,stage){if(!validId(projectId)||!validId(runId)||!stages.has(stage))return;try{await command(['SET',key(projectId,runId),stage,'EX',600])}catch{}}
export async function getWritingProgress(projectId,runId){if(!validId(projectId)||!validId(runId))return null;try{const stage=await command(['GET',key(projectId,runId)]);return stages.has(stage)?stage:null}catch{return null}}
