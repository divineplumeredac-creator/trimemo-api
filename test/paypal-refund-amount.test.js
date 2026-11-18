import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRefundAmount } from '../lib/paypal-refund-amount.js';
test('calcule le total restant et un montant partiel sans erreurs de décimales',()=>{
 assert.deepEqual(chooseRefundAmount({mode:'full',currency:'EUR',total:'10.00',alreadyRefunded:'1.25'}),{minorUnits:875,amount:'8.75',currency:'EUR'});
 assert.equal(chooseRefundAmount({mode:'partial',currency:'EUR',total:'10',amount:'0,30'}).amount,'0.30');
});
test('refuse les montants non valides ou au-dessus du solde',()=>{
 for(const amount of ['0','-1','1.999','10.01','10','NaN'])assert.throws(()=>chooseRefundAmount({mode:'partial',currency:'EUR',total:'10',amount}));
 assert.throws(()=>chooseRefundAmount({mode:'full',currency:'EUR',total:'10',alreadyRefunded:'10'}));
 assert.throws(()=>chooseRefundAmount({mode:'partial',currency:'JPY',total:'1000',amount:'1.5'}));
});
