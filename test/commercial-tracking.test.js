import test from "node:test";
import assert from "node:assert/strict";
import { COMMERCIAL_LAUNCH_AT, inCommercialPeriod, isCommercialOrder, isCommercialProject, isExplicitSandboxOrder, filterCommercialRows } from "../lib/commercial-tracking.js";
const before="2026-11-15T22:59:59Z",start="2026-11-15T23:00:00Z";
test("Suivi dès le 16 novembre à minuit heure de Porto-Novo",()=>{
 assert.equal(COMMERCIAL_LAUNCH_AT,"2026-11-15T23:00:00.000Z");
 assert.equal(inCommercialPeriod(before),false);assert.equal(inCommercialPeriod(start),true);
 assert.equal(inCommercialPeriod(null),false);
});
test("Les commandes FedaPay Sandbox restent hors ventes réelles",()=>{
 assert.equal(isExplicitSandboxOrder({order_id:"fedapay-sandbox:123"}),true);
 assert.equal(isCommercialOrder({order_id:"fedapay-sandbox:123",status:"paid",paid_at:start}),false);
});
test("Paiement reçu après lancement sur projet ancien: compté",()=>{
 assert.equal(isCommercialOrder({order_id:"PAYPAL",status:"paid",created_at:before,paid_at:start}),true);
 assert.equal(isCommercialOrder({order_id:"PAYPAL",status:"consumed",created_at:before,paid_at:before}),false);
});
test("Commandes annulées ou en attente: jamais confondues avec ventes",()=>{
 assert.equal(isCommercialOrder({order_id:"P",status:"pending",created_at:start}),true);
 assert.equal(isCommercialOrder({order_id:"P",status:"pending",created_at:before}),false);
 assert.equal(isCommercialOrder({order_id:"P",status:"cancelled",created_at:start}),false);
});
test("Les projets anciens repris après lancement sont suivis",()=>{
 assert.equal(isCommercialProject({created_at:before,updated_at:start}),true);
 assert.equal(isCommercialProject({created_at:before,updated_at:before}),false);
});
test("Historique conservé sans suppression de données",()=>{
 const rows=[{id:1,created_at:before},{id:2,created_at:start}];
 assert.deepEqual(filterCommercialRows(rows,false).map(x=>x.id),[2]);
 assert.deepEqual(filterCommercialRows(rows,true).map(x=>x.id),[1,2]);
});
