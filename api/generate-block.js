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

    const typeDoc = String(
      project.typeDoc ||
      project.typeDocument ||
      body.typeDoc ||
      "Mémoire"
    ).trim();

    const contexte = String(
      project.contexte ||
      project.context ||
      ""
    ).trim();

    const consignes = String(
      project.consignes ||
      project.instructions ||
      ""
    ).trim();

    const blockTitle = String(
      body.blockTitle ||
      body.block ||
      body.title ||
      "Introduction générale"
    ).trim();

    const problematic = body.problematique || "";
    const plan = body.plan || "";

    const targetWords = Number(
      body.targetWords ||
      body.words ||
      900
    );

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet du projet est obligatoire."
      });
    }

    const safeWordTarget =
      Number.isFinite(targetWords) && targetWords > 0
        ? Math.min(Math.max(targetWords, 300), 1500)
        : 900;

    const systemPrompt = `
Tu es un rédacteur académique spécialisé dans la rédaction de blocs
destinés aux mémoires, rapports, thèses et travaux universitaires.

Ta mission consiste uniquement à rédiger le bloc demandé.

INSTRUCTIONS SPÉCIFIQUES DU BLOC :

1. Rédige exclusivement sur le sujet transmis.
2. Respecte la problématique et le plan sélectionnés.
3. Respecte le titre et la fonction du bloc.
4. Utilise uniquement les informations fournies ou vérifiables.
5. Ne crée aucun terrain, pays, institution ou résultat non fourni.
6. Ne présente aucune donnée inventée comme un fait.
7. Utilise des références académiques vérifiables lorsque nécessaire.
8. Ne fabrique jamais d'auteur, de date, de DOI ou de citation.
9. Si une information manque, formule une analyse prudente.
10. Ne répète pas les idées déjà développées dans le bloc.
11. Assure une progression logique entre les paragraphes.
12. Chaque paragraphe doit développer une idée principale.
13. Utilise un style rigoureux, fluide et naturel.
14. Évite les clichés rédactionnels et les formulations artificielles.
15. Évite les répétitions de connecteurs.
16. Évite les phrases trop longues et les constructions complexes.
17. La limite recommandée est de 28 mots par phrase.
18. Une phrase légèrement plus longue ne doit pas bloquer la génération.
19. N'utilise pas systématiquement « en effet », « de plus » ou « cependant ».
20. Évite l'utilisation excessive des adverbes en « -ment ».
21. Évite les pronoms « ceci » et « cela » lorsqu'ils sont inutiles.
22. Définis les sigles lors de leur première apparition.
23. Adapte le vocabulaire à la discipline réelle.
24. Ne transforme pas le sujet en un autre domaine.
25. Ne conclus pas tout le mémoire dans un seul bloc.
26. Ne produis aucun commentaire sur ton fonctionnement.
27. Retourne uniquement le contenu demandé dans le format JSON.

Le bloc doit être original, cohérent et directement exploitable
dans un travail académique.
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
${typeDoc}

Contexte fourni :
${contexte || "Aucun contexte complémentaire"}

Consignes :
${consignes || "Aucune consigne complémentaire"}

PROBLÉMATIQUE :
${typeof problematic === "string"
  ? problematic
  : JSON.stringify(problematic)}

PLAN :
${typeof plan === "string"
  ? plan
  : JSON.stringify(plan)}

BLOC À RÉDIGER :
${blockTitle}

OBJECTIF DE LONGUEUR :
Environ ${safeWordTarget} mots.

TÂCHE

Rédige ce bloc avec une progression académique claire.
Respecte le sujet et le plan.
Ne force aucun contexte géographique ou institutionnel.
Ne crée aucune donnée empirique.
Utilise des références vérifiables si elles sont nécessaires.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
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

    const rawText = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Erreur OpenAI lors de la rédaction du bloc.",
        details: rawText.slice(0, 1000)
      });
    }

    let result;

    try {
      const data = JSON.parse(rawText);

      const outputText =
        data.output_text ||
        data.output
          ?.flatMap((item) => item.content || [])
          ?.map((item) => item.text || "")
          ?.join("") ||
        "";

      result = JSON.parse(outputText);
    } catch {
      return res.status(502).json({
        error: "La réponse OpenAI n'a pas pu être interprétée."
      });
    }

    const content = String(result.content || "").trim();

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
      id: result.id || `block-${Date.now()}`,
      title: result.title || blockTitle,
      content,
      wordCount,
      sources: Array.isArray(result.sources)
        ? result.sources
        : []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur interne du serveur."
    });
  }
          }
