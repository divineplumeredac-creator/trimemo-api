import {setCors} from '../lib/http.js';
import {requireOwner} from '../lib/owner-auth.js';
import {requireOwnedProject} from '../lib/owned-project-gate.js';
import {getWritingProgress} from '../lib/writing-progress.js';
export default async function handler(req,res){
 setCors(res,req,'POST, OPTIONS');if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='POST')return res.status(405).json({error:'Méthode non autorisée.'});
 try{const {project={},generationId,ownerMode}=req.body||{};if(ownerMode===true)requireOwner(req);else await requireOwnedProject(req,project);const stage=await getWritingProgress(String(project.projectId||project.project_id||''),generationId);return res.status(200).json({stage});}
 catch(error){return res.status(Number(error?.status)||500).json({error:'Progression indisponible.'})}
}
