import {supabaseAdminRequest} from './admin-data.js';
const fail=message=>Object.assign(new Error(message),{status:409});
export function validateWritingOrder(state, blockId, planId) {
 const blocks=Array.isArray(state?.blocks)?state.blocks:[];
 if(!blockId || !planId || String(state?.selectedPlan?.id||'')!==String(planId) || !blocks.length)throw fail('Enregistrez votre plan avant de poursuivre la rédaction.');
 const matches=blocks.map((b,i)=>String(b?.id||'')===String(blockId)?i:-1).filter(i=>i>=0);
 if(matches.length!==1)throw fail('Ce bloc ne correspond pas au plan enregistré.');
 const previous=blocks.slice(0,matches[0]);
 if(previous.some(b=>b?.status!=='done'||!String(b?.content||'').trim()))throw fail('Rédigez d’abord les blocs précédents dans l’ordre du plan.');
}
export async function assertWritingOrder({projectId,ownerMode,blockId,planId}) {
 const table=ownerMode?'trimemo_owner_projects':'trimemo_project_state';
 const result=await supabaseAdminRequest('/rest/v1/'+table+'?project_id=eq.'+encodeURIComponent(projectId)+'&select=state&limit=1');
 if(!result.data?.[0]?.state)throw fail('Enregistrez votre projet avant de poursuivre la rédaction.');
 validateWritingOrder(result.data[0].state,blockId,planId);
}
