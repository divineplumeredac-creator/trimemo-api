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

    const problematic = body.problematique || {
      titre: body.titreProblematique || ""
    };

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

    const problematicText =
      typeof problematic === "string"
        ? problematic
        : JSON.stringify(problematic);

    const requestedCount = Number(body.count || 3);
    const count = requestedCount === 1 ? 1 : 3;

    const pages = Number(
      project.pages ||
      project.nombrePages ||
      body.pages ||
      30
    );

    const totalWords = pages * 320;

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet du projet est obligatoire."
      });
    }

    const systemPrompt = `
Tu es un spécialiste de la conception de plans académiques.

Ta mission consiste uniquement à produire des plans détaillés adaptés
à la problématique et au sujet transmis.

INSTRUCTIONS SPÉCIFIQUES :

1. Respecte strictement le sujet réel.
2. Respecte la problématique sélectionnée.
3. Adapte le plan au domaine et au niveau d'étude.
4. Respecte le type de document demandé.
5. Ne force aucun pays, aucune ville, aucune institution et aucun terrain.
6. N'invente aucune donnée empirique.
7. Ne crée pas de résultats qui n'existent pas.
8. Ne transforme pas un sujet culturel en sujet commercial.
9. Ne transforme pas un sujet économique en sujet littéraire.
10. Évite les titres génériques et répétitifs.
11. Construis une progression logique.
12. Maintiens une cohérence entre les parties, chapitres et sous-parties.
13. Évite les plans artificiels ou mécaniques.
14. Ne rédige pas le contenu des chapitres.
15. Retourne uniquement le JSON demandé.

La longueur maximale de 28 mots par phrase est autorisée.
Aucun contrôle bloquant de longueur ne doit être appliqué.
La cohérence du plan reste prioritaire.
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

Nombre de pages :
${pages}

Objectif approximatif :
${totalWords} mots

Contexte :
${contexte || "Aucun contexte complémentaire"}

Consignes :
${consignes || "Aucune consigne complémentaire"}

PROBLÉMATIQUE SÉLECTIONNÉE :
${problematicText}

TÂCHE

Génère ${count} plan(s) détaillé(s).
Chaque plan doit comporter :
- un titre cohérent ;
- une description ;
- une approche méthodologique ;
- des parties ou chapitres ;
- des sous-parties précises ;
- une répartition indicative des mots.

Le plan doit répondre à la problématique sélectionnée.
Ne crée pas de contexte absent des données du projet.
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
              name: "plans_response",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  plans: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        id: {
                          type: "string"
                        },
                        titre: {
                          type: "string"
                        },
                        description: {
                          type: "string"
                        },
                        approche: {
                          type: "string"
                        },
                        totalWords: {
                          type: "integer"
                        },
                        originalite: {
                          type: "string"
                        },
                        chapters: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                              title: {
                                type: "string"
                              },
                              subparts: {
                                type: "array",
                                items: {
                                  type: "string"
                                }
                              },
                              wordCount: {
                                type: "integer"
                              },
                              sources: {
                                type: "array",
                                items: {
                                  type: "string"
                                }
                              }
                            },
                            required: [
                              "title",
                              "subparts",
                              "wordCount",
                              "sources"
                            ]
                          }
                        }
                      },
                      required: [
                        "id",
                        "titre",
                        "description",
                        "approche",
                        "totalWords",
                        "originalite",
                        "chapters"
                      ]
                    }
                  }
                },
                required: [
                  "plans"
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
        error: "Erreur OpenAI lors de la génération des plans.",
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

    const plans = Array.isArray(result.plans)
      ? result.plans.slice(0, count)
      : [];

    if (plans.length === 0) {
      return res.status(502).json({
        error: "Aucun plan exploitable n'a été généré."
      });
    }

    return res.status(200).json({
      plans
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur interne du serveur."
    });
  }
                }
