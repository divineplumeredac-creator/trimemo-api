import { setCors } from "../lib/http.js";
import { createPremiumToken } from "../lib/premium-auth.js";
import { getOrderRecord } from "../lib/order-ledger.js";

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
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  // Accept identifiers produced by the historical browser fallback so those
  // guest projects can still be claimed and resumed after an upgrade.
  // Both account-project links and project state use UUID keys in Supabase.
  return isUuid ? id : "";
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
async function ensureProjectState(projectId, userId, suppliedState) {
  const rows = await supabase("/rest/v1/trimemo_project_state?project_id=eq." + encodeURIComponent(projectId) + "&select=owner_id,state&limit=1");
  const current = Array.isArray(rows) ? rows[0] : null;
  if (current?.owner_id && current.owner_id !== userId) {
    const error = new Error("Ce projet est déjà rattaché à un autre compte client.");
    error.status = 409;
    throw error;
  }

  const state = suppliedState && typeof suppliedState === "object" && !Array.isArray(suppliedState)
    ? suppliedState
    : current?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    const error = new Error("L’état de ce projet est introuvable. Rechargez l’aperçu et réessayez.");
    error.status = 409;
    throw error;
  }
  const embeddedProjectId = String(state.project?.projectId || state.project?.project_id || "").trim();
  if (embeddedProjectId && embeddedProjectId !== projectId) {
    const error = new Error("L’état transmis ne correspond pas à ce projet.");
    error.status = 400;
    throw error;
  }
  const version = Number(state.schemaVersion || 1);
  if (!Number.isInteger(version) || version < 1 || version > 2) {
    const error = new Error("La version de ce projet n’est pas prise en charge. Rechargez la page et réessayez.");
    error.status = 400;
    throw error;
  }
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > 3_500_000) {
    const error = new Error("Le projet est trop volumineux pour être associé au compte.");
    error.status = 413;
    throw error;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
  await supabase("/rest/v1/trimemo_project_state?on_conflict=project_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      owner_id: userId,
      state,
      updated_at: now.toISOString(),
      expires_at: expiresAt,
    }),
  });
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
    if (action === "refresh") {
      const refreshToken = String(body.refreshToken || "").trim();
      if (!refreshToken) return fail(res, 401, "La session doit être renouvelée. Connectez-vous à nouveau.");
      const { url, key } = config();
      const response = await fetch(url + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(10000),
      });
      const session = await response.json().catch(() => ({}));
      if (!response.ok || !session?.access_token || !session?.user?.id) return fail(res, 401, "Votre session ne peut plus être renouvelée. Connectez-vous à nouveau.");
      return res.status(200).json({
        success: true, token: session.access_token, refresh_token: session.refresh_token || refreshToken,
        expires_at: session.expires_at || null,
        user: { id: session.user.id, email: session.user.email || "", firstName: String(session.user.user_metadata?.first_name || ""), lastName: String(session.user.user_metadata?.last_name || "") },
      });
    }
    if (action === "update-profile") {
      const token = String(body.token || "").trim();
      const firstName = String(body.firstName || "").trim().slice(0, 100);
      const lastName = String(body.lastName || "").trim().slice(0, 100);
      if (!firstName || !lastName) return fail(res, 400, "Le prénom et le nom sont obligatoires.");
      const user = await authenticate(token);
      const { url, key } = config();
      const response = await fetch(url + "/auth/v1/admin/users/" + encodeURIComponent(user.id), {
        method: "PUT", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ user_metadata: { ...(user.user_metadata || {}), first_name: firstName, last_name: lastName, full_name: firstName + " " + lastName } }),
        signal: AbortSignal.timeout(10000),
      });
      const updated = await response.json().catch(() => ({}));
      if (!response.ok) return fail(res, 502, "Impossible d'enregistrer le nom du profil.");
      return res.status(200).json({ success: true, user: { id: updated.id || user.id, email: updated.email || user.email || "", firstName, lastName } });
    }
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
        refresh_token: session.refresh_token || null,
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
        console.error("TRIMEMO_PASSWORD_RECOVERY_REQUEST_FAILED", { name: String(error?.name || "Error"), code: String(error?.code || "RECOVERY_REQUEST_FAILED") });
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
      const orders = await supabase("/rest/v1/trimemo_orders?project_id=eq." + encodeURIComponent(projectId) + "&status=in.(paid,consumed)&select=order_id,project_id,project_snapshot,status&order=paid_at.desc&limit=1");
      const paidOrder = Array.isArray(orders) ? orders[0] : null;
      const isActuallyPaid = Boolean(paidOrder?.order_id && paidOrder.project_id === projectId && paidOrder.project_snapshot);
      if (isActuallyPaid) premiumToken = createPremiumToken(paidOrder.project_snapshot, paidOrder.order_id);
      return res.status(200).json({
        success: true,
        project: { project_id: membership.project_id, subject: membership.subject, payment_status: isActuallyPaid ? "paid" : "draft" },
        state: restoredState,
        premium_token: premiumToken || null,
        updatedAt: stateRow.updated_at,
      });
    }
    if (action === "link") {
      const projectId = validProjectId(body.projectId);
      if (!projectId) return fail(res, 400, "Identifiant de projet invalide.");
      const subject = String(body.subject || "Projet académique").trim().slice(0, 240) || "Projet académique";
      // A project may belong to exactly one client account. Never trust a browser-supplied paid flag.
      // Insert with ignore-duplicates so concurrent claims cannot overwrite the first owner.
      const existingRows = await supabase("/rest/v1/trimemo_client_projects?project_id=eq." + encodeURIComponent(projectId) + "&select=user_id,payment_status&limit=1");
      let existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing && existing.user_id !== user.id) return fail(res, 409, "Ce projet est déjà rattaché à un autre compte client.");

      let paymentStatus = "draft";
      const orderId = String(body.orderId || "").trim();
      if (orderId) {
        const order = await getOrderRecord(orderId);
        if (!order || !["paid", "consumed"].includes(order.status) || order.project_id !== projectId) {
          return fail(res, 403, "La commande payée ne correspond pas à ce projet. Le statut du paiement n'a pas été modifié.");
        }
        paymentStatus = "paid";
      } else {
        // Do not preserve legacy "paid" flags unless the private payment ledger confirms them.
        const paidOrders = await supabase("/rest/v1/trimemo_orders?project_id=eq." + encodeURIComponent(projectId) + "&status=in.(paid,consumed)&select=order_id&limit=1");
        if (existing?.payment_status === "paid" && Array.isArray(paidOrders) && paidOrders.length) paymentStatus = "paid";
      }

      const now = new Date().toISOString();
      if (!existing) {
        // The account-project table has a foreign key to project_state.
        // Save/claim the authenticated project's state first so the link can
        // be created without dropping the guest's preview or draft.
        await ensureProjectState(projectId, user.id, body.state);
        const inserted = await supabase("/rest/v1/trimemo_client_projects?on_conflict=project_id", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify({ user_id: user.id, project_id: projectId, subject, payment_status: paymentStatus, updated_at: now }),
        });
        existing = Array.isArray(inserted) ? inserted[0] : null;
        if (!existing) {
          const racedRows = await supabase("/rest/v1/trimemo_client_projects?project_id=eq." + encodeURIComponent(projectId) + "&select=user_id,payment_status&limit=1");
          existing = Array.isArray(racedRows) ? racedRows[0] : null;
        }
      }
      if (!existing || existing.user_id !== user.id) return fail(res, 409, "Ce projet est déjà rattaché à un autre compte client.");

      // Update only the authenticated owner's row. user_id is never changed by this path.
      const updatedRows = await supabase("/rest/v1/trimemo_client_projects?project_id=eq." + encodeURIComponent(projectId) + "&user_id=eq." + encodeURIComponent(user.id), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ subject, payment_status: paymentStatus, updated_at: now }),
      });
      if (!Array.isArray(updatedRows) || !updatedRows.length) return fail(res, 409, "Le rattachement du projet a changé. Rechargez votre compte puis réessayez.");
      return res.status(200).json({ success: true, payment_status: paymentStatus });
    }
    return fail(res, 400, "Action de compte inconnue.");
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("TRIMEMO_CLIENT_ACCOUNT_FAILED", { action, status, code: String(error?.code || "CLIENT_ACCOUNT_ERROR"), name: String(error?.name || "Error") });
    const publicError = status >= 500 ? (status === 503 ? "Le service de comptes clients est indisponible." : "Opération de compte impossible. Réessayez dans quelques instants.") : String(error?.message || "Opération de compte impossible.");
    return fail(res, status >= 400 && status < 500 ? status : 502, publicError);
  }
}
