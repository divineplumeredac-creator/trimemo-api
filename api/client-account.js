import { setCors } from "../lib/http.js";
import { createPremiumToken } from "../lib/premium-auth.js";
import { rateLimit } from "../lib/rate-limit.js";

function cors(res, req) { setCors(res, req, "POST, OPTIONS"); }
function fail(res, status, error) { return res.status(status).json({ error }); }
function config() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    const error = new Error("Le service de comptes clients n'est pas configuré.");
    error.status = 503;
    throw error;
  }
  return { url, key };
}
async function supabase(path, init = {}) {
  const { url, key } = config();
  const response = await fetch(url + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const error = new Error(String(data?.msg || data?.message || data?.error_description || data?.error || "Opération de compte impossible."));
    error.status = response.status;
    throw error;
  }
  return data;
}
function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
function validProjectId(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}
async function authenticate(token) {
  if (!token) {
    const error = new Error("Connectez-vous à votre compte client.");
    error.status = 401;
    throw error;
  }
  const { url, key } = config();
  const response = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(8000),
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) {
    const error = new Error("Votre session a expiré. Connectez-vous à nouveau.");
    error.status = 401;
    throw error;
  }
  const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : 0;
  if (user.app_metadata?.trimemo_access === "suspended" || (Number.isFinite(bannedUntil) && bannedUntil > Date.now())) {
    const error = new Error("L'accès à ce compte Trimémo est suspendu. Contactez le support.");
    error.status = 403;
    throw error;
  }
  return user;
}
async function listProjects(userId) {
  const { url, key } = config();
  const query = new URLSearchParams({
    select: "project_id,subject,payment_status,created_at,updated_at",
    user_id: "eq." + userId,
    order: "updated_at.desc",
  });
  const response = await fetch(url + "/rest/v1/trimemo_client_projects?" + query, {
    headers: { apikey: key, Authorization: "Bearer " + key },
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error("Impossible de charger les projets du compte.");
  return Array.isArray(data) ? data : [];
}
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return fail(res, 405, "Méthode non autorisée.");
  const body = req.body || {};
  const action = String(body.action || "").trim();
  try {
    if (action === "signup") await rateLimit(req, "client-signup", 5, 60 * 60 * 1000);
    if (action === "login") await rateLimit(req, "client-login", 10, 15 * 60 * 1000);
    if (action === "signup" || action === "login") {
      const email = validEmail(body.email);
      const password = String(body.password || "");
      const firstName = String(body.firstName || "").trim().slice(0, 100);
      const lastName = String(body.lastName || "").trim().slice(0, 100);
      if (!email) return fail(res, 400, "Saisissez une adresse e-mail valide.");
      if (password.length < 8 || password.length > 128) return fail(res, 400, "Le mot de passe doit contenir entre 8 et 128 caractères.");
      if (action === "signup" && (!firstName || !lastName)) return fail(res, 400, "Le prénom et le nom sont obligatoires pour créer un compte.");
      if (action === "signup") {
        const { url, key } = config();
        const created = await fetch(url + "/auth/v1/admin/users", {
          method: "POST",
          headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { product: "Trimémo", first_name: firstName, last_name: lastName, full_name: (firstName + " " + lastName).trim() } }),
          signal: AbortSignal.timeout(10000),
        });
        const result = await created.json().catch(() => ({}));
        if (!created.ok) {
          const message = String(result?.msg || result?.message || result?.error_description || result?.error || "");
          if (/already|registered|exists|duplicate/i.test(message)) return fail(res, 409, "Un compte existe déjà avec cette adresse. Connectez-vous plutôt.");
          return fail(res, created.status === 422 ? 400 : 502, "La création du compte a échoué. Vérifiez l'adresse e-mail et réessayez.");
        }
      }
      const session = await supabase("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!session?.access_token || !session?.user?.id) return fail(res, 401, "Connexion impossible. Vérifiez vos identifiants.");
      return res.status(200).json({
        success: true,
        token: session.access_token,
        expires_at: session.expires_at || null,
        user: { id: session.user.id, email: session.user.email || email, firstName: String(session.user.user_metadata?.first_name || firstName || ""), lastName: String(session.user.user_metadata?.last_name || lastName || "") },
      });
    }
    if (action === "forgot-password") {
      const email = validEmail(body.email);
      if (!email) return fail(res, 400, "Saisissez une adresse e-mail valide.");
      const { url, key } = config();
      const frontendUrl = String(process.env.TRIMEMO_FRONTEND_URL || "https://trimemo-frontend.vercel.app").trim().replace(/\/$/, "");
      const redirectTo = frontendUrl + "/?reset-password=1";
      try {
        await fetch(url + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), {
          method: "POST",
          headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        console.error("TRIMEMO_PASSWORD_RECOVERY_REQUEST_FAILED", { message: String(error?.message || "unknown").slice(0, 120) });
        return fail(res, 502, "Le service de récupération est temporairement indisponible. Réessayez plus tard.");
      }
      // Réponse volontairement identique, que l'adresse existe ou non.
      return res.status(200).json({ success: true, message: "Si un compte correspond à cette adresse, un lien de réinitialisation sera envoyé." });
    }
    if (action === "reset-password") {
      const recoveryToken = String(body.recoveryToken || "").trim();
      const password = String(body.password || "");
      if (!recoveryToken) return fail(res, 400, "Le lien de réinitialisation est invalide ou expiré. Demandez un nouveau lien.");
      if (password.length < 8 || password.length > 128) return fail(res, 400, "Le nouveau mot de passe doit contenir entre 8 et 128 caractères.");
      const { url, key } = config();

      // Supabase peut renvoyer soit un access_token JWT dans le fragment,
      // soit un token_hash opaque dans l'URL. Dans le second cas, vérifier
      // explicitement le jeton de récupération avant de changer le mot de passe.
      let accessToken = recoveryToken;
      if (recoveryToken.split(".").length !== 3) {
        const verification = await fetch(url + "/auth/v1/verify", {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/json" },
          body: JSON.stringify({ token_hash: recoveryToken, type: "recovery" }),
          signal: AbortSignal.timeout(10000),
        });
        const verified = await verification.json().catch(() => ({}));
        if (!verification.ok || !verified?.access_token) {
          return fail(res, 400, "Le lien de réinitialisation est invalide ou expiré. Demandez un nouveau lien.");
        }
        accessToken = String(verified.access_token);
      }

      const response = await fetch(url + "/auth/v1/user", {
        method: "PUT",
        headers: { apikey: key, Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.id) {
        return fail(res, 400, "Le lien de réinitialisation est invalide ou expiré. Demandez un nouveau lien.");
      }
      return res.status(200).json({ success: true, message: "Mot de passe modifié. Vous pouvez maintenant vous connecter." });
    }
    const token = String(body.token || "").trim();
    const user = await authenticate(token);
    if (action === "list") {
      return res.status(200).json({ success: true, projects: await listProjects(user.id), user: { id: user.id, email: user.email } });
    }
    if (action === "resume") {
      const projectId = validProjectId(body.projectId);
      if (!projectId) return fail(res, 400, "Identifiant de projet invalide.");
      const { url, key } = config();
      const membershipQuery = new URLSearchParams({
        select: "project_id,subject,payment_status",
        user_id: "eq." + user.id,
        project_id: "eq." + projectId,
        limit: "1",
      });
      const membershipResponse = await fetch(url + "/rest/v1/trimemo_client_projects?" + membershipQuery, {
        headers: { apikey: key, Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(8000),
      });
      const memberships = await membershipResponse.json().catch(() => []);
      const membership = Array.isArray(memberships) ? memberships[0] : null;
      if (!membership) return fail(res, 404, "Ce projet n'est pas rattaché à votre compte client.");
      const stateRows = await supabase("/rest/v1/trimemo_project_state?project_id=eq." + encodeURIComponent(projectId) + "&select=project_id,state,updated_at&limit=1");
      const stateRow = Array.isArray(stateRows) ? stateRows[0] : null;
      if (!stateRow?.state) return fail(res, 404, "Le contenu sauvegardé de ce projet est introuvable. Contactez le support avant de créer un nouveau projet.");

      // Restaure l'introduction de l'aperçu dans le bloc de rédaction.
      // Historiquement, l'introduction restait dans state.preview, tandis que le bloc Introduction générale était vide.
      const restoredState = { ...stateRow.state };
      const blocks = Array.isArray(restoredState.blocks) ? restoredState.blocks.map((block) => ({ ...block })) : [];
      const previewIntroduction = String(restoredState.preview?.introduction?.content || "").trim();
      if (previewIntroduction) {
        const introIndex = blocks.findIndex((block) => String(block.kind || "").toLowerCase() === "introduction");
        if (introIndex >= 0 && !String(blocks[introIndex].content || "").trim()) {
          blocks[introIndex] = {
            ...blocks[introIndex],
            content: previewIntroduction,
            wordCount: previewIntroduction.split(/\s+/u).filter(Boolean).length,
            status: "done",
            error: undefined,
          };
        }
      }
      restoredState.blocks = blocks;
      const preferredBlock = blocks.find((block) => block.id === restoredState.selectedWritingBlockId);
      if (!preferredBlock || preferredBlock.status === "done" || String(preferredBlock.content || "").trim()) {
        const nextPending = blocks.find((block) => block.status !== "done" || !String(block.content || "").trim());
        restoredState.selectedWritingBlockId = nextPending?.id || preferredBlock?.id || blocks.find((block) => String(block.content || "").trim())?.id || blocks[0]?.id || null;
      }

      let premiumToken = "";
      if (membership.payment_status === "paid") {
        const orders = await supabase("/rest/v1/trimemo_orders?project_id=eq." + encodeURIComponent(projectId) + "&status=in.(paid,consumed)&select=order_id,project_id,project_snapshot,status&order=paid_at.desc&limit=1");
        const order = Array.isArray(orders) ? orders[0] : null;
        if (order?.order_id && order.project_snapshot) {
          premiumToken = createPremiumToken(order.project_snapshot, order.order_id);
        }
      }
      return res.status(200).json({
        success: true,
        project: { project_id: membership.project_id, subject: membership.subject, payment_status: membership.payment_status },
        state: restoredState,
        premium_token: premiumToken || null,
        updatedAt: stateRow.updated_at,
      });
    }
    if (action === "link") {
      const projectId = validProjectId(body.projectId);
      if (!projectId) return fail(res, 400, "Identifiant de projet invalide.");
      const subject = String(body.subject || "Projet académique").trim().slice(0, 240) || "Projet académique";
      const { url, key } = config();
      const existingMemberships = await supabase("/rest/v1/trimemo_client_projects?project_id=eq." + encodeURIComponent(projectId) + "&select=user_id&limit=2");
      if (Array.isArray(existingMemberships) && existingMemberships.some((row) => row.user_id !== user.id)) {
        return fail(res, 403, "Ce projet est déjà rattaché à un autre compte client.");
      }
      // Le navigateur ne peut jamais déclarer lui-même un projet comme payé.
      const paidOrders = await supabase("/rest/v1/trimemo_orders?project_id=eq." + encodeURIComponent(projectId) + "&status=in.(paid,consumed)&select=order_id,project_id,status,project_snapshot&order=paid_at.desc&limit=1");
      const paidOrder = Array.isArray(paidOrders) ? paidOrders[0] : null;
      const snapshotClientId = String(paidOrder?.project_snapshot?.clientUserId || "").trim();
      if (snapshotClientId && snapshotClientId !== user.id) {
        return fail(res, 403, "Cette commande appartient à un autre compte client.");
      }
      const legacyOrderBelongsToClient = Array.isArray(existingMemberships) && existingMemberships.some((row) => row.user_id === user.id);
      const ownsPaidOrder = snapshotClientId ? snapshotClientId === user.id : legacyOrderBelongsToClient;
      const paymentStatus = paidOrder?.project_id === projectId && paidOrder?.project_snapshot && ownsPaidOrder ? "paid" : "draft";
      if (body.paid === true && paymentStatus !== "paid") return fail(res, 403, "Le paiement de ce projet n’est pas confirmé dans le registre sécurisé.");
      const now = new Date().toISOString();
      const response = await fetch(url + "/rest/v1/trimemo_client_projects?on_conflict=user_id,project_id", {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ user_id: user.id, project_id: projectId, subject, payment_status: paymentStatus, updated_at: now }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Impossible d'associer ce projet à votre compte client.");
      return res.status(200).json({ success: true });
    }
    return fail(res, 400, "Action de compte inconnue.");
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("TRIMEMO_CLIENT_ACCOUNT_FAILED", { action, status, message: String(error?.message || "unknown").slice(0, 180) });
    return fail(res, status === 503 ? 503 : (status >= 400 && status < 500 ? status : 502), status === 503 ? "Le service de comptes clients ou de limitation des requêtes est indisponible." : String(error?.message || "Opération de compte impossible."));
  }
}
