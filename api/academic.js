import { rateLimit } from "../lib/rate-limit.js";
import { setCors } from "../lib/http.js";
const FRONTEND_URL = process.env.TRIMEMO_FRONTEND_URL || "https://trimemo-frontend.vercel.app";

function cors(res, req) {
  setCors(res, req, "POST, OPTIONS");
}
function fail(res, status, error, details) {
  return res.status(status).json({ error, ...(details ? { details } : {}) });
}


function countWords(value) {
  return String(value || "").trim().split(/\s+/u).filter(Boolean).length;
}

// Limite le texte sans couper un paragraphe en plein milieu.
function limitByParagraphs(value, limit) {
  const source = String(value || "").trim();
  if (!source || limit <= 0) return "";
  if (countWords(source) <= limit) return source;

  let paragraphs = source.split(/\n\s*\n/u).map((part) => part.trim()).filter(Boolean);
  let sentenceFallback = false;
  if (paragraphs.length === 1) {
    sentenceFallback = true;
    // Certains anciens aperçus ont perdu leurs sauts de paragraphe.
    // Dans ce cas, garder des phrases complètes plutôt que couper au milieu d'une phrase.
    const sentences = paragraphs[0].match(/[^.!?]+[.!?]+|[^.!?]+$/gu) || [];
    paragraphs = sentences.map((part) => part.trim()).filter(Boolean);
  }

  const kept = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);
    if (used + words > limit) break;
    kept.push(paragraph);
    used += words;
  }
  return kept.join(sentenceFallback ? " " : "\n\n");
}

function normalizePreviewWordLimit(preview) {
  const limitedIntroduction = limitByParagraphs(preview?.introduction?.content, 2500);
  const remaining = Math.max(0, 2500 - countWords(limitedIntroduction));
  const limitedChapter = limitByParagraphs(preview?.chapterOne?.content, remaining);
  if (!limitedIntroduction || !limitedChapter) {
    throw new Error("L’aperçu dépasse 2 500 mots et ne peut pas être ajusté sans couper un paragraphe. Régénérez l’aperçu avant le paiement.");
  }
  return {
    ...preview,
    introduction: { ...preview.introduction, content: limitedIntroduction, wordCount: countWords(limitedIntroduction) },
    chapterOne: { ...preview.chapterOne, content: limitedChapter, wordCount: countWords(limitedChapter) },
  };
}

function paypalBaseUrl() {
  return String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function formulaOf(project = {}) {
  const formula = String(project.formula || project.formule || "").toUpperCase();
  if (["LICENCE", "MASTER", "DOCTORAT"].includes(formula)) return formula;
  return "MASTER";
}


function priceForProject(project = {}) {
  const quote = verifyPricingQuote(project.pricingQuoteToken, project);
  if (!quote) throw new Error("L'estimation du projet est absente ou expirée. Relancez l'analyse du projet avant le paiement.");
  return {
    value: String(quote.checkoutAmount),
    currency: String(quote.checkoutCurrency || "EUR"),
    label: String(project.typeDoc || "Projet académique") + " Trimémo",
    quote,
  };
}

async function paypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET doivent être configurés.");
  }

  const auth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const response = await fetch(paypalBaseUrl() + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || "Impossible d'obtenir le jeton PayPal.");
  }
  return data.access_token;
}

async function createPaypalOrder(project) {
  const token = await paypalAccessToken();
  const price = priceForProject(project);
  const returnUrl = FRONTEND_URL + "/?payment=paypal";
  const cancelUrl = FRONTEND_URL + "/?payment=paypal_cancelled";

  const response = await fetch(paypalBaseUrl() + "/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json",
      "PayPal-Request-Id": "trimemo-" + crypto.randomUUID(),
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: "trimemo",
        custom_id: `${formulaOf(project)}|${paymentBinding(project)}`,
        description: "Accès premium Trimémo",
        amount: {
          currency_code: price.currency,
          value: price.value,
        },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Trimémo",
            locale: "fr-FR",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.details?.[0]?.description || data?.message || "Impossible de créer la commande PayPal.");
  }

  const approval = Array.isArray(data.links)
    ? data.links.find((link) => link.rel === "approve")
    : null;

  if (!approval?.href) {
    throw new Error("PayPal n'a retourné aucune URL d'approbation.");
  }

  return {
    id: data.id,
    url: approval.href,
    amount: price.value,
    currency: price.currency,
    label: price.label,
  };
}

async function capturePaypalOrder(orderId) {
  const token = await paypalAccessToken();
  const response = await fetch(
    paypalBaseUrl() + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
        "PayPal-Request-Id": "trimemo-capture-" + orderId,
      },
      body: "{}",
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.details?.[0]?.description || data?.message || "Impossible de confirmer le paiement PayPal.");
  }

  return data;
}

async function getPaypalOrder(orderId) {
  const token = await paypalAccessToken();
  const response = await fetch(paypalBaseUrl() + "/v2/checkout/orders/" + encodeURIComponent(orderId), {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.details?.[0]?.description || data?.message || "Commande PayPal introuvable.");
  }
  return data;
}

import crypto from "node:crypto";
import { createPremiumToken, paymentBinding, projectFingerprint } from "../lib/premium-auth.js";
import { verifyPricingQuote } from "../lib/pricing.js";
import { assertOrderLedgerReady, recordPendingOrder, recordPaidOrder, getOrderRecord } from "../lib/order-ledger.js";
import { hydrateProjectFiles } from "../lib/project-file-store.js";

export default async function handler(req, res) {
  cors(res, req);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Méthode non autorisée.");

  const action = String(req.query?.action || "").trim();
  const body = req.body || {};
  let project = body.project || {};

  try {
    if (action === "create-paypal-order") await rateLimit(req, "create-paypal-order", 10, 60 * 60 * 1000);
    if (action === "verify-paypal") await rateLimit(req, "verify-paypal", 20, 60 * 60 * 1000);
    if (action === "create-mobile-money") await rateLimit(req, "create-mobile-money", 5, 60 * 60 * 1000);
    if (action === "verify-mobile-money") await rateLimit(req, "verify-mobile-money", 10, 60 * 60 * 1000);
    if (action === "create-paypal-order" && Array.isArray(project.files) && project.files.length) project = await hydrateProjectFiles(project);
    if (action === "create-paypal-order") {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return fail(res, 503, "Le registre sécurisé des commandes n'est pas configuré. Le paiement est temporairement indisponible.");
      await assertOrderLedgerReady();
      if (!String(project.sujet || "").trim()) {
        return fail(res, 400, "Le sujet du projet est obligatoire.");
      }
      const rawFormula = String(project.formula || project.formule || "").toUpperCase();
      if (!['LICENCE', 'MASTER', 'DOCTORAT'].includes(rawFormula)) {
        return fail(res, 400, "Cette demande nécessite un devis personnalisé.");
      }
      if (!String(project.projectId || project.project_id || '').trim()) {
        return fail(res, 400, "Identifiant de projet manquant.");
      }
      if (!String(project.paymentProblematicId || "").trim() || !String(project.paymentPlanId || "").trim()) {
        return fail(res, 400, "Validez une problématique et un plan avant de payer.");
      }
      const preview = project.paidPreviewSnapshot;
      if (!preview?.problematic?.question || preview.problematic.id !== project.paymentProblematicId || !Array.isArray(preview.plan?.parts) || !preview.plan.parts.length || preview.plan.id !== project.paymentPlanId || !String(preview.introduction?.content || "").trim() || !String(preview.chapterOne?.content || "").trim()) {
        return fail(res, 400, "L'aperçu de 2 500 mots doit être généré à partir de la problématique et du plan retenus avant le paiement.");
      }
      let normalizedPreview;
      try {
        normalizedPreview = normalizePreviewWordLimit(preview);
      } catch (error) {
        return fail(res, 400, error instanceof Error ? error.message : "Régénérez l’aperçu avant le paiement.");
      }
      project = { ...project, formula: formulaOf(project), paidPreviewSnapshot: normalizedPreview };
      const order = await createPaypalOrder(project);
      await recordPendingOrder({ orderId: order.id, project, amount: order.amount, currency: order.currency });
      return res.status(200).json(order);
    }

    if (action === "verify-paypal") {
      const orderId = String(body.id || "").trim();
      if (!orderId) return fail(res, 400, "Identifiant PayPal manquant.");

      await assertOrderLedgerReady();
      const savedOrder = await getOrderRecord(orderId);
      if (!savedOrder || !["pending", "paid"].includes(savedOrder.status) || !savedOrder.project_snapshot) {
        return res.status(403).json({ status: "ORDER_NOT_AVAILABLE", error: "Cette commande n'est pas disponible ou son crédit a déjà été consommé." });
      }
      if (!String(project.sujet || project.subject || "").trim() || String(project.projectId || project.project_id || "") !== savedOrder.project_id || projectFingerprint(project) !== savedOrder.project_fingerprint) {
        // The server snapshot is authoritative; never bind the payment to browser-edited project data.
        project = savedOrder.project_snapshot;
      }
      const expectedPriceQuote = { value: String(savedOrder.amount), currency: String(savedOrder.currency) };

      // 1) Lire la commande ; ne capturer que si elle est approuvée (évite l'erreur ORDER_ALREADY_CAPTURED au rechargement).
      let order = await getPaypalOrder(orderId);
      if (String(order.status).toUpperCase() === "APPROVED") {
        // Contrôle du lien commande/projet AVANT capture : un mauvais projet ne doit jamais débiter le client.
        const preCustomId = String(order.purchase_units?.[0]?.custom_id || "");
        const preBinding = preCustomId.split("|")[1] || "";
        const preExpected = Buffer.from(paymentBinding(project));
        const preGot = Buffer.from(preBinding);
        if (!preBinding || preGot.length !== preExpected.length || !crypto.timingSafeEqual(preGot, preExpected)) {
          return res.status(403).json({ status: "PAYMENT_PROJECT_MISMATCH", error: "Cette commande PayPal n’est pas associée à ce projet. Aucun débit n’a été effectué." });
        }
        order = await capturePaypalOrder(orderId);
      }
      const status = String(order.status || "").toUpperCase();
      if (status !== "COMPLETED") {
        return res.status(402).json({ status, error: "Le paiement PayPal n'est pas confirmé." });
      }

      // 2) Le prix attendu vient de la formule enregistrée dans la commande, pas du navigateur.
      const unit = order.purchase_units?.[0] || {};
      const capture = unit.payments?.captures?.[0] || {};
      const customId = String(unit.custom_id || capture.custom_id || "").trim();
      const [paidFormulaRaw, paidBinding] = customId.split("|");
      const formula = String(paidFormulaRaw || "").toUpperCase();
      if (!["LICENCE", "MASTER", "DOCTORAT"].includes(formula) || !paidBinding) {
        return res.status(402).json({ status: "INVALID_PAYMENT_BINDING", error: "La commande PayPal n’est pas liée à un projet Trimémo valide." });
      }
      const expectedBinding = paymentBinding(project);
      const paidBuffer = Buffer.from(paidBinding);
      const expectedBuffer = Buffer.from(expectedBinding);
      if (paidBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(paidBuffer, expectedBuffer)) {
        return res.status(403).json({ status: "PAYMENT_PROJECT_MISMATCH", error: "Cette commande PayPal n’est pas associée à ce projet." });
      }
      const expectedPrice = expectedPriceQuote.value;
      const expectedCurrency = expectedPriceQuote.currency;
      const paidPrice = String(capture.amount?.value || "");
      if (!paidPrice || paidPrice !== expectedPrice || String(capture.amount?.currency_code || "") !== expectedCurrency) {
        console.error("PayPal AMOUNT_MISMATCH", { orderId, paidPrice, expectedPrice, expectedCurrency, formula });
        return res.status(402).json({
          status: "AMOUNT_MISMATCH",
          error: "Le montant payé ne correspond pas à la formule. Contactez le support avec la référence " + orderId + ".",
        });
      }

      // Le paiement doit être inscrit durablement avant de délivrer un droit premium.
      await recordPaidOrder({ orderId: order.id, project: { ...project, formula }, amount: paidPrice, currency: expectedCurrency, captureId: capture.id });
      // 3) Le jeton est émis pour le projet réellement payé.
      return res.status(200).json({
        status: "PAID",
        order_id: order.id,
        formula,
        premium_token: createPremiumToken({ ...project, formula }, order.id),
        capture_id: capture.id || null,
        project: savedOrder.project_snapshot,
        preview: savedOrder.project_snapshot?.paidPreviewSnapshot || null,
      });
    }

    if (action === "create-mobile-money") {
      return fail(
        res,
        501,
        "Le paiement Mobile Money n'est pas encore raccordé à un prestataire.",
        "Configurez un prestataire de paiement avant d'activer ce bouton."
      );
    }

    if (action === "verify-mobile-money") {
      return fail(res, 501, "La vérification Mobile Money n'est pas configurée.");
    }

    return fail(res, 404, "Action de paiement inconnue.");
  } catch (error) {
    console.error("TRIMEMO_PAYMENT_FAILED", { status: Number(error?.status) || 500, code: String(error?.code || "PAYMENT_ERROR") });
    return fail(res, Number(error?.status) || 500, Number(error?.status) && Number(error.status) < 500 ? error.message : "Le service de paiement est temporairement indisponible.");
  }
}
