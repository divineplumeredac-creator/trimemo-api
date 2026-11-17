import { validOptout } from '../lib/followup-email.js';
import { supabaseAdminRequest } from '../lib/admin-data.js';
export default async function handler(req,res){
 const u=String(req.query?.u||''),s=String(req.query?.s||'');
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(!validOptout(u,s))return res.status(400).send('<p>Ce lien n’est pas valide.</p>');
 if(req.method==='GET')return res.status(200).send('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Préférences Trimémo</title><body><h1>Rappels Trimémo</h1><p>Vous pouvez arrêter les messages de rappel concernant vos projets.</p><form method="post"><button type="submit">Ne plus recevoir ces rappels</button></form></body></html>');
 if(req.method!=='POST')return res.status(405).send('<p>Méthode non autorisée.</p>');
 try{await supabaseAdminRequest('/rest/v1/trimemo_followup_optouts?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({user_id:u})});return res.status(200).send('<p>Votre choix est enregistré. Vous ne recevrez plus ces rappels.</p>')}catch{return res.status(503).send('<p>Votre choix n’a pas pu être enregistré. Réessayez plus tard.</p>')}
}
