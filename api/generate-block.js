export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "La clé API OpenAI est absente."
    });
  }

  try {
    const body = req.body || {};
    const project = body.project || body;

    const block =
      body.block && typeof body.block === "object"
        ? body.block
        : {};

    const sujet = String(
      project.sujet ||
      project.subject ||
      body.sujet ||
      ""
    ).trim();

    const domaine = String(
      project.domaine ||
      body.domaine ||
      ""
    ).trim();

    const niveau = String(
      project.niveau ||
      body.niveau ||
      ""
    ).trim();

    const typeDocument = String(
      project.typeDoc ||
      project.typeDocument ||
      body.typeDoc ||
      "Mémoire"
    ).trim();

    const contexte = String(
      project.contexte ||
      project.context ||
      body.contexte ||
      ""
    ).trim();

    const consignes = String(
      project.consignes ||
      project.instructions ||
      body.consignes ||
      ""
    ).trim();

    const problematic =
      body.problematic ||
      body.problematique ||
      "";

    const plan = body.plan || "";

    const preceding = Array.isArray(body.preceding)
      ? body.preceding
      : [];

    const blockTitle = String(
      body.blockTitle ||
      block.title ||
      body.title ||
      "Introduction générale"
    ).trim();

    const requestedWords = Number(
      body.targetWords ||
      body.words ||
      block.expectedWords ||
      900
    );

    const targetWords = Number.isFinite(requestedWords)
      ? Math.min(
          Math.max(Math.round(requestedWords), 300),
          900
        )
      : 900;

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet du projet est obligatoire."
      });
    }

    const systemPrompt = `
Tu es un rédacteur académique spécialisé dans les mémoires,
rapports, thèses et travaux universitaires.

MISSION :

Rédiger uniquement le bloc demandé.

Une section ou une sous-section peut être développée
en plusieurs productions successives.

Chaque production ne doit jamais dépasser 900 mots.

INSTRUCTIONS STYLISTIQUES OBLIGATOIRES :

1. Respecte strictement le sujet, la problématique,
le niveau d'études et la discipline.

2. Produis un texte académique rigoureux, clair,
naturel et directement exploitable.

3. Construis chaque paragraphe autour d'une idée principale.

4. Respecte une longueur maximale de 20 mots par phrase
autant que possible.

5. Si une phrase dépasse 20 mots, reformule-la
ou divise-la sans perdre son sens.

6. Évite les phrases mécaniques, les clichés d'intelligence
artificielle et les formulations répétitives.

7. Évite l'emploi abusif de :
« en effet », « de plus » et « cependant ».

8. Évite les adverbes en « -ment » lorsqu'ils sont inutiles.

9. Évite les pronoms « ceci » et « cela »
lorsqu'ils n'apportent aucune précision.

10. Ne utilise pas de tiret long dans le corps du texte.

11. Définis les sigles lors de leur première apparition.

12. Adapte le vocabulaire à la discipline réelle du sujet.

13. Intègre un ancrage béninois uniquement lorsque
le sujet le justifie réellement.

14. Ne force jamais un ancrage béninois
si le sujet ne le nécessite pas.

15. Ne crée aucune donnée empirique, statistique,
institution ou résultat non fourni.

16. Ne présente aucune donnée inventée comme un fait.

17. N'invente aucun auteur, aucune date,
aucun DOI et aucune citation.

18. Utilise uniquement des références vérifiables
lorsqu'une référence est nécessaire.

19. Évite les répétitions avec les blocs précédents.

20. Assure une progression logique entre
les productions successives.

21. Ne conclus pas tout le mémoire dans un seul bloc.

22. Ne produis aucun commentaire sur ton fonctionnement.

23. Retourne uniquement un objet JSON conforme
au schéma demandé.
`;

    const userPrompt = `
DONNÉES DU PROJET

Sujet :
${sujet}

Domaine :
${domaine || "Non précisé"}

Niveau :
${niveau || "Non précisé"}

Type de document :
${typeDocument}

Contexte :
${contexte || "Aucun contexte complémentaire"}

Consignes :
${consignes || "Aucune consigne complémentaire"}


PROBLÉMATIQUE :

${
  typeof problematic === "string"
    ? problematic
    : JSON.stringify(problematic)
}


PLAN :

${
  typeof plan === "string"
    ? plan
    : JSON.stringify(plan)
}


BLOC À RÉDIGER :

${blockTitle}


BLOCS PRÉCÉDENTS :

${
  preceding.length
    ? JSON.stringify(preceding)
    : "Aucun bloc précédent"
}


OBJECTIF DE LONGUEUR :

Produire environ ${targetWords} mots,
sans dépasser 900 mots.


RÈGLE DE CONTINUITÉ :

La section ou la sous-section peut nécessiter
plusieurs productions successives.

Rédige uniquement la présente partie.

Poursuis les idées des blocs précédents
sans les répéter.

Ne termine pas artificiellement toute la section
si son développement doit continuer.

Respecte le sujet, la problématique et le plan.

Ne force aucun contexte géographique
ou institutionnel.

Ne crée aucune donnée empirique.
`;

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model:
            process.env.OPENAI_MODEL ||
            "gpt-5.6-luna",

          tools: [
            {
              type: "web_search"
            }
          ],

          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: systemPrompt
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: userPrompt
                }
              ]
            }
          ],

          text: {
            format: {
              type: "json_schema",
              name: "block_response",
              strict: true,

              schema: {
                type: "object",
                additionalProperties: false,

                properties: {
                  id: {
                    type: "string"
                  },

                  title: {
                    type: "string"
                  },

                  content: {
                    type: "string"
                  },

                  wordCount: {
                    type: "integer"
                  },

                  sources: {
                    type: "array",

                    items: {
                      type: "object",
                      additionalProperties: false,

                      properties: {
                        author: {
                          type: "string"
                        },

                        year: {
                          type: "string"
                        },

                        title: {
                          type: "string"
                        },

                        doi: {
                          type: "string"
                        }
                      },

                      required: [
                        "author",
                        "year",
                        "title",
                        "doi"
                      ]
                    }
                  }
                },

                required: [
                  "id",
                  "title",
                  "content",
                  "wordCount",
                  "sources"
                ]
              }
            }
          }
        })
      }
    );

    const rawText = await openAIResponse.text();

    if (!openAIResponse.ok) {
      return res.status(openAIResponse.status).json({
        error:
          "Erreur OpenAI lors de la rédaction du bloc.",

        details: rawText.slice(0, 1500)
      });
    }

    const apiData = JSON.parse(rawText);

    const outputText =
      apiData.output_text ||
      (apiData.output || [])
        .flatMap((item) => item.content || [])
        .map((item) => item.text || "")
        .join("");

    if (!outputText) {
      return res.status(502).json({
        error:
          "La réponse OpenAI ne contient aucun texte exploitable."
      });
    }

    let result;

    try {
      result = JSON.parse(outputText);
    } catch {
      return res.status(502).json({
        error:
          "La réponse structurée d'OpenAI est invalide."
      });
    }

    const content = String(
      result.content || ""
    ).trim();

    if (!content) {
      return res.status(502).json({
        error: "Le bloc généré est vide."
      });
    }

    const wordCount = content
      .split(/\s+/)
      .filter(Boolean)
      .length;

    return res.status(200).json({
      id:
        result.id ||
        `block-${Date.now()}`,

      title:
        result.title ||
        blockTitle,

      content,

      wordCount,

      sources:
        Array.isArray(result.sources)
          ? result.sources
          : []
    });

  } catch (error) {
    return res.status(500).json({
      error:
        error?.message ||
        "Erreur interne du serveur."
    });
  }
}
