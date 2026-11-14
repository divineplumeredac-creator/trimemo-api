import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../api/client-account.js',import.meta.url),'utf8');
test('le retour d’e-mail préserve la destination ambassadeurs même sur un autre navigateur',()=>{
 assert.match(src,/callback\.searchParams\.set\("next", "ambassadors"\)/);
 assert.match(src,/action === "resend-confirmation"/);
 assert.equal(src.split('const redirectTo = confirmationReturnUrl(req, body);').length-1,2);
});
test('un lien email token_hash est vérifié côté serveur',()=>{
 assert.match(src,/action === "verify-email"/);
 assert.match(src,/\/auth\/v1\/verify/);
 assert.match(src,/token_hash: tokenHash, type/);
 assert.match(src,/confirmed\.user\.email_confirmed_at/);
});
