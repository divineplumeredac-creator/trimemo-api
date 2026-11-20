import { calculateQuote, signPricingQuote, verifyPricingQuote, verifyExpiredQuoteForPayment } from './pricing.js';
import { readAdminSettings } from './admin-data.js';

const invalid = () => Object.assign(new Error("L’estimation ne correspond plus au projet. Veuillez contacter le support pour reprendre votre paiement."), {status:409});

// An expired quote can only be renewed for the same authenticated project and
// exact attachments, and only if the current tariff gives the displayed price.
export async function renewPaymentQuote(project, getSettings = () => readAdminSettings({strict:true})) {
  const fresh = verifyPricingQuote(project?.pricingQuoteToken, project);
  if (fresh) return {project, quote:fresh};
  const signed = verifyExpiredQuoteForPayment(project?.pricingQuoteToken, project);
  if (!signed) throw invalid();
  const settings = await getSettings();
  const current = calculateQuote({project, country:signed.country, complexity:signed.complexity, pricingConfig:settings.pricing_config});
  const same = ['market','currency','estimatedAmount','checkoutCurrency','checkoutAmount'].every(key => String(current[key]) === String(signed[key]));
  if (!same) throw Object.assign(new Error("Le tarif de ce projet a changé depuis votre dernière visite. Contactez le support avant de poursuivre le paiement."), {status:409});
  const token = signPricingQuote(current, project);
  const renewed = {...project, pricingQuoteToken:token};
  return {project:renewed, quote:verifyPricingQuote(token, renewed)};
}
