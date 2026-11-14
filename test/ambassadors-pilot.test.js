import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../api/ambassadors.js',import.meta.url),'utf8');
test('la candidature requiert une session et un consentement',()=>{
 assert.match(src,/const user=await client\(req\)/);
 assert.match(src,/if\(!body\.consent\)/);
});
test('l’attribution vérifie la propriété du projet et refuse le parrainage personnel',()=>{
 assert.match(src,/trimemo_client_projects\?project_id=eq\./);
 assert.match(src,/ambassador\.user_id===user\.id/);
 assert.match(src,/trimemo_orders\?project_id=eq\./);
});
test('les versements sont manuels, sur commandes confirmées et après 14 jours',()=>{
 assert.match(src,/if\(action==='admin-payout'\)/);
 assert.match(src,/14\*24\*3600\*1000/);
 assert.match(src,/refund_status!=='none'/);
});
