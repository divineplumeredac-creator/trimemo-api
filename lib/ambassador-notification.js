const trim = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const htmlEscape = value => trim(value, 150).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const programUrl = 'https://trimemo-redac.company/?view=ambassadors';

export function decisionEmail(candidate) {
  const accepted = candidate?.status === 'active';
  if (!accepted && candidate?.status !== 'rejected') throw new Error('Invalid notification status');
  const name = trim(candidate.full_name, 120) || 'candidat';
  const paragraphs = accepted ? [
    'Votre candidature au programme Ambassadeurs Trimémo a été acceptée.',
    'Votre espace ambassadeur est maintenant actif. Connectez-vous pour accéder à votre lien personnel et faire découvrir Trimémo.',
    'Vous bénéficiez d’une commission de 10 % sur les achats confirmés attribués à votre lien, selon les conditions du programme.',
  ] : [
    'Merci pour l’intérêt que vous portez au programme Ambassadeurs Trimémo.',
    'Après examen, votre candidature n’a pas été retenue pour cette sélection.',
    'Votre compte Trimémo reste accessible. Cette décision ne concerne que le programme Ambassadeurs.',
  ];
  const subject = accepted ? 'Trimémo : votre candidature ambassadeur est acceptée'
    : 'Trimémo : réponse à votre candidature ambassadeur';
  const link = accepted ? programUrl : 'https://trimemo-redac.company/';
  const label = accepted ? 'Accéder à mon espace ambassadeur' : 'Découvrir Trimémo';
  const greeting = 'Bonjour ' + name + ',';
  const plain = [greeting, ...paragraphs, label + ' : ' + link, 'Cordialement,','L’équipe Trimémo'].join('\n\n');
  const html = '<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#1B4D3E;line-height:1.65"><main style="max-width:620px;margin:auto;padding:24px">'
    + '<h1>Trimémo</h1><p>' + htmlEscape(greeting) + '</p>'
    + paragraphs.map(p => '<p>' + htmlEscape(p) + '</p>').join('')
    + '<p><a href="' + link + '" style="background:#1B4D3E;color:#fff;padding:12px 18px;text-decoration:none;border-radius:8px">' + label + '</a></p>'
    + '<p>Cordialement,<br>L’équipe Trimémo</p></main></body></html>';
  return {subject,text:plain,html};
}

/** Résultat d'envoi distinct du statut d'approbation en base, sans divulguer le destinataire. */
export async function notifyAmbassadorDecision(candidate) {
  const key = trim(process.env.RESEND_API_KEY, 1000);
  const from = trim(process.env.TRIMEMO_EMAIL_FROM, 254);
  if (!key || !from) return {status:'unconfigured',message:'Décision enregistrée. L’adresse d’envoi e-mail doit être configurée sur le serveur.'};
  const userId = trim(candidate?.user_id, 80);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId))
    return {status:'failed',message:'Décision enregistrée, mais le compte destinataire est introuvable.'};
  const base = trim(process.env.SUPABASE_URL, 500).replace(/\/$/,'');
  const secret = trim(process.env.SUPABASE_SERVICE_ROLE_KEY, 1500);
  if (!base || !secret) return {status:'failed',message:'Décision enregistrée, mais le service d’envoi est indisponible.'};
  try {
    const lookup = await fetch(base + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      headers:{apikey:secret,Authorization:'Bearer '+secret},
      signal:AbortSignal.timeout(10000)
    });
    if (!lookup.ok) throw new Error('account_' + lookup.status);
    const account = await lookup.json();
    const to = trim(account?.user?.email || account?.email, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
      return {status:'failed',message:'Décision enregistrée, mais le candidat n’a pas d’adresse e-mail valide.'};
    const response = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[to],...decisionEmail(candidate)}),
      signal:AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('provider_' + response.status);
    return {status:'accepted',message:'Décision enregistrée. Notification transmise au service e-mail.'};
  } catch (error) {
    console.error('AMBASSADOR_NOTIFICATION_FAILED',{code:trim(error?.message || 'delivery_error',70)});
    return {status:'failed',message:'Décision enregistrée, mais l’e-mail n’a pas pu être envoyé. Vous pouvez utiliser « Renvoyer l’e-mail ».'};
  }
}
