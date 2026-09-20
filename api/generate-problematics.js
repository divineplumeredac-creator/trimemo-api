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

    const requestedCount = Number(body.count || 3);
    const count = requestedCount === 1 ? 1 : 3;

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet du projet est obligatoire."
      });
    }

    const systemPrompt = `
Tu es un spécialiste de la méthodologie de recherche académique francophone.

Ta mission consiste uniquement à proposer des problématiques de recherche.

INSTRUCTIONS SPÉCIFIQUES :

1. Utilise exclusivement le sujet transmis par l'utilisateur.
2. Respecte le domaine, le niveau et le type de document.
3. Ne change pas le sens du sujet.
4. Ne force aucun pays, aucune ville, aucune institution et aucun terrain.
5. N'invente aucune donnée, aucune enquête et aucun résultat.
6. N'introduis pas de contexte géographique absent des informations reçues.
7. Adapte le vocabulaire à la discipline réelle du sujet.
8. Évite les formulations commerciales ou managériales hors sujet.
9. Propose des problématiques distinctes.
10. Chaque problématique doit présenter une véritable question de recherche.
11. Évite les questions trop générales, vagues ou descriptives.
12. Évite les répétitions entre les problématiques.
13. Ne donne aucun commentaire en dehors du JSON demandé.

La longueur maximale de 28 mots par phrase est autorisée.
Ne bloque pas la génération pour une phrase légèrement plus longue.
La pertinence scientifique reste prioritaire.
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

Consignes fournies :
${consignes || "Aucune consigne complémentaire"}

TÂCHE

Génère ${count} problématique(s) distincte(s).
Chaque problématique doit être adaptée au sujet réel.
Ne remplace pas le sujet par un autre thème.
Ne crée aucun terrain ou contexte non fourni.
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
              name: "problematiques_response",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  problematiques: {
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
                        texte: {
                          type: "string"
                        },
                        angle: {
                          type: "string"
                        },
                        pertinence: {
                          type: "string"
                        }
                      },
                      required: [
                        "id",
                        "titre",
                        "texte",
                        "angle",
                        "pertinence"
                      ]
                    }
                  }
                },
                required: [
                  "problematiques"
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
        error: "Erreur OpenAI lors de la génération des problématiques.",
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

    const problematiques = Array.isArray(result.problematiques)
      ? result.problematiques.slice(0, count)
      : [];

    if (problematiques.length === 0) {
      return res.status(502).json({
        error: "Aucune problématique exploitable n'a été générée."
      });
    }

    return res.status(200).json({
      problematiques
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur interne du serveur."
    });
  }
}
