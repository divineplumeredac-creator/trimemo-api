export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée. Utilisez POST." });
  }

  const body = req.body || {};
  const project = body.project || {};

  const sujet = String(body.sujet || project.sujet || "").trim();
  const domaine = String(body.domaine || project.domaine || "Non précisé").trim();
  const niveau = String(body.niveau || project.niveau || "Master").trim();
  const typeDoc = String(body.typeDoc || project.typeDoc || "Mémoire").trim();
  const consignes = String(body.consignes || project.consignes || "").trim();
  const problematicInput = body.problematic || body.problematique || {};
  const problematic =
    typeof problematicInput === "string"
      ? problematicInput
      : problematicInput.question ||
        problematicInput.title ||
        problematicInput.titre ||
        problematicInput.texte ||
        "";

  if (!sujet) {
    return res.status(400).json({ error: "Le sujet est obligatoire." });
  }

  if (!problematic) {
    return res.status(400).json({
      error: "Sélectionnez une problématique avant de générer les plans.",
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY est absente dans les variables d’environnement Vercel.",
    });
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

  const systemPrompt = `
Vous êtes un concepteur de plans universitaires spécialisé en ${domaine}.
Vous devez produire exactement trois plans réellement distincts pour un ${typeDoc} de niveau ${niveau}.

RÈGLES OBLIGATOIRES :
1. Répondez uniquement avec un objet JSON valide contenant la clé "plans".
2. La clé "plans" doit contenir exactement trois objets.
3. Chaque plan doit présenter une logique différente :
   - Plan 1 : approche conceptuelle et théorique.
   - Plan 2 : approche empirique, méthodologique ou centrée sur le terrain.
   - Plan 3 : approche problématisée, comparative, critique ou prospective, selon la pertinence du sujet.
4. Ne réutilisez pas la même organisation de chapitres entre les trois plans.
5. Chaque plan doit contenir :
   id, title, description, approach, totalWords,
   introductionGeneral, parts, conclusionGeneral.
6. Chaque plan doit contenir deux ou trois parties.
7. Chaque partie doit contenir deux ou trois chapitres.
8. Chaque chapitre doit contenir deux ou trois sections.
9. Chaque section peut contenir deux ou trois subsections.
10. Chaque partie, chapitre, section et sous-section doit avoir :
    id, number, title, description.
11. Chaque chapitre doit contenir wordCount.
12. Le plan doit distinguer clairement Partie, Chapitre, Section et Sous-section.
13. L'introduction générale et la conclusion générale doivent contenir :
    title, description, wordCount.
14. Le totalWords doit être un nombre cohérent avec les wordCount des chapitres.
15. Adaptez strictement le plan au sujet, au domaine, au niveau et à la problématique.
16. N'utilisez pas de jargon commercial ou technologique si le sujet ne le justifie pas.
17. L'ancrage béninois doit être utilisé uniquement si le sujet, le terrain ou les consignes le justifie.
18. Évitez les titres génériques et les répétitions.
19. Les descriptions doivent être précises et exploitables pour une rédaction académique.
20. N'inventez aucune source, référence, DOI ou donnée empirique.
21. Ne rédigez pas le mémoire. Produisez uniquement sa structure détaillée.
`;

  const userPrompt = `
SUJET :
${sujet}

DOMAINE :
${domaine}

NIVEAU :
${niveau}

TYPE DE DOCUMENT :
${typeDoc}

PROBLÉMATIQUE SÉLECTIONNÉE :
${problematic}

CONSIGNES :
${consignes || "Aucune consigne complémentaire."}

Générez maintenant exactement trois plans distincts et complets.
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const rawText = await response.text();
    let payload;

    try {
      payload = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        error: "La réponse d’OpenAI n’est pas un JSON exploitable.",
        providerStatus: response.status,
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.error?.message || "OpenAI a refusé la génération des plans.",
        providerStatus: response.status,
      });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({
        error: "OpenAI n’a retourné aucun contenu pour les plans.",
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(502).json({
        error: "OpenAI a retourné un contenu qui n’est pas un JSON valide.",
      });
    }

    const plans = Array.isArray(parsed?.plans) ? parsed.plans : [];

    if (plans.length !== 3) {
      return res.status(502).json({
        error: `La réponse OpenAI doit contenir exactement trois plans. Nombre reçu : ${plans.length}.`,
      });
    }

    const invalidPlan = plans.find(
      (plan) =>
        !plan ||
        typeof plan !== "object" ||
        !plan.title ||
        !Array.isArray(plan.parts) ||
        plan.parts.length < 2 ||
        !plan.introductionGeneral ||
        !plan.conclusionGeneral
    );

    if (invalidPlan) {
      return res.status(502).json({
        error: "La structure retournée par OpenAI est incomplète. Les plans n’ont pas été acceptés.",
      });
    }

    return res.status(200).json({
      plans,
      meta: {
        model,
        subject: sujet,
        domain: domaine,
        level: niveau,
        count: plans.length,
      },
    });
  } catch (error) {
    console.error("[generate-plans] OpenAI request failed:", error);
    return res.status(502).json({
      error:
        error instanceof Error
          ? `Échec de la communication avec OpenAI : ${error.message}`
          : "Échec de la communication avec OpenAI.",
    });
  }
}
