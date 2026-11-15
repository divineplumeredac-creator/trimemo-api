import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAdminSettings } from '../lib/admin-data.js';
import { defaultPricingConfig, marketForCountry, calculateQuote } from '../lib/pricing.js';

test('les paramètres commerciaux et la grille du serveur ont une seule source de vérité', () => {
  const current=defaultAdminSettings().pricing_config;
  assert.deepEqual(current,defaultPricingConfig());
  for (const country of ['BJ','FR','CA','GB','CH','NG','UNKNOWN']) {
    const market=marketForCountry(country,current);
    assert.equal(market.currency,current.markets[market.market].currency);
    assert.equal(market.rates.memoire,current.markets[market.market].rates.memoire);
    const price=calculateQuote({country,project:{typeDoc:'Mémoire',niveau:'Master',pages:60},pricingConfig:current});
    assert.equal(price.currency,market.currency);
  }
});
test('la grille ne peut pas être mutée entre deux évaluations', () => {
  const a=defaultPricingConfig();
  a.markets.africa.rates.memoire=999999;
  assert.equal(defaultPricingConfig().markets.africa.rates.memoire,250);
});
