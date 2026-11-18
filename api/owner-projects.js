import { requireOwner } from '../lib/owner-auth.js';
import { setCors } from '../lib/http.js';
import { supabaseAdminRequest } from '../lib/admin-data.js';
const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x||''));
export default async function handler(req,res){
 setCors(res,req,'POST, OPTIONS');if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='POST')return res.status(405).json({error:'Méthode non autorisée.'});
 try{requireOwner(req);const {action,projectId,state,version}=req.body||{};
  if(action==='list'){const result=await supabaseAdminRequest('/rest/v1/trimemo_owner_projects?select=project_id,subject,updated_at&order=updated_at.desc&limit=200');return res.status(200).json({projects:result.data});}
  if(!uuid(projectId))return res.status(400).json({error:'Projet invalide.'});
  if(action==='get'){const result=await supabaseAdminRequest('/rest/v1/trimemo_owner_projects?project_id=eq.'+encodeURIComponent(projectId)+'&select=state,updated_at&limit=1');if(!result.data?.[0])return res.status(404).json({error:'Projet introuvable.'});return res.status(200).json({state:result.data[0].state,version:result.data[0].updated_at});}
  if(action==='save'){if(!state||typeof state!=='object'||String(state.project?.projectId)!==projectId||!String(state.project?.sujet||'').trim())return res.status(400).json({error:'Projet incomplet.'});if(Buffer.byteLength(JSON.stringify(state),'utf8')>4000000)return res.status(413).json({error:'Le projet est trop volumineux pour être enregistré.'});const row={project_id:projectId,subject:String(state.project.sujet).trim().slice(0,240),state,updated_at:new Date().toISOString()};let saved;
    if(version){saved=await supabaseAdminRequest('/rest/v1/trimemo_owner_projects?project_id=eq.'+encodeURIComponent(projectId)+'&updated_at=eq.'+encodeURIComponent(String(version)),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});}
    else{saved=await supabaseAdminRequest('/rest/v1/trimemo_owner_projects?on_conflict=project_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(row)});}
    if(!Array.isArray(saved.data)||saved.data.length!==1)return res.status(409).json({error:'Ce projet a changé ailleurs. Rouvrez-le depuis la liste avant de le modifier.'});
    return res.status(200).json({ok:true,version:saved.data[0].updated_at});}
  return res.status(400).json({error:'Action invalide.'});
 }catch(e){return res.status(Number(e?.status)||500).json({error:'Impossible de gérer les projets pour le moment.'})}
}
