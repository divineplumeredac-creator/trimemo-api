import { setCors } from "../lib/http.js";
const FRONTEND_URL = process.env.TRIMEMO_FRONTEND_URL || "https://trimemo-frontend.vercel.app";

function cors(res) {
  setCors(res, "POST, OPTIONS");
}
function fail(res, status, error, details) {
  return res.status(status).json({ error, ...(details ? { details } : {}) });
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

function priceForFormula(formula) {
  if (formula === "LICENCE") return { value: "27.00", label: "Mémoire Licence" };
  if (formula === "DOCTORAT") return { value: "76.00", label: "Thèse" };
  return { value: "38.00", label: "Mémoire Master" };
}

function priceForProject(project = {}) {
  return priceForFormula(formulaOf(project));
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
          currency_code: "EUR",
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
    currency: "EUR",
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
import { createPremiumToken, paymentBinding } from "../lib/premium-auth.js";

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Méthode non autorisée.");

  const action = String(req.query?.action || "").trim();
  const body = req.body || {};
  const project = body.project || {};

  try {
    if (action === "create-paypal-order") {
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
      const order = await createPaypalOrder(project);
      return res.status(200).json(order);
    }

    if (action === "verify-paypal") {
      const orderId = String(body.id || "").trim();
      if (!orderId) return fail(res, 400, "Identifiant PayPal manquant.");

      // Sans projet, impossible de lier le déblocage : on s'arrête AVANT de capturer l'argent.
      if (!String(project.sujet || project.subject || "").trim()) {
        return res.status(400).json({
          status: "PROJECT_MISSING",
          error: "Projet introuvable dans ce navigateur. Rouvrez Trimémo sur l'appareil utilisé pour payer, puis réessayez : votre paiement n'a pas été débité.",
        });
      }

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
      const expectedPrice = priceForFormula(formula).value;
      const paidPrice = String(capture.amount?.value || "");
      if (!paidPrice || paidPrice !== expectedPrice || String(capture.amount?.currency_code || "EUR") !== "EUR") {
        console.error("PayPal AMOUNT_MISMATCH", { orderId, paidPrice, expectedPrice, formula });
        return res.status(402).json({
          status: "AMOUNT_MISMATCH",
          error: "Le montant payé ne correspond pas à la formule. Contactez le support avec la référence " + orderId + ".",
        });
      }

      // 3) Le jeton est émis pour la formule réellement payée.
      return res.status(200).json({
        status: "PAID",
        order_id: order.id,
        formula,
        premium_token: createPremiumToken({ ...project, formula }, order.id),
        capture_id: capture.id || null,
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
    console.error("Trimémo academic payment error:", error);
    return fail(res, 500, error?.message || "Erreur du service de paiement.");
  }
}
