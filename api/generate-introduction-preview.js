
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];

  const texts = [];

  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;

    for (const content of item.content) {
      if (typeof content?.text === "string" && content.text.trim()) {
        texts.push(content.text.trim());
      }
    }
  }

  return texts.join("\n").trim();
}

function parseJsonResponse(text) {
  if (!text) {
    throw new Error("La réponse de l'API est vide.");
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const possibleJson = text.slice(firstBrace, lastBrace + 1);
      return JSON.parse(possibleJson);
    }

    throw new Error("La réponse de l'API n'est pas un JSON valide.");
  }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée. Utilisez POST."
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "La clé OPENAI_API_KEY est absente de la configuration."
    });
  }

  try {
    const body = req.body || {};

    const project = body.project || body.projet || body;

    const subject = normalizeText(
      project.sujet ||
      project.subject ||
      body.sujet ||
      body.subject
    );

    const domain = normalizeText(
      project.domaine ||
      project.domain ||
      body.domaine ||
      body.domain
    );

    const level = normalizeText(
      project.niveau ||
      project.level ||
      body.niveau ||
      body.level
    );

    const documentType = normalizeText(
      project.typeDoc ||
      project.typeDocument ||
      project.documentType ||
      body.typeDoc ||
      body.typeDocument ||
      body.documentType
    );

    const formula = normalizeText(
      project.formule ||
      project.formula ||
      body.formule ||
      body.formula
    );

    const context = normalizeText(
      project.contexte ||
      project.context ||
      body.contexte ||
      body.context
    );

    const instructions = normalizeText(
      project.consignes ||
      project.instructions ||
      body.consignes ||
      body.instructions
    );

    const problematic = normalizeText(
      body.problematic ||
      body.problematique ||
      project.problematic ||
      project.problematique
    );

    const plan = body.plan || project.plan || null;

    const targetWords = Number(
      body.targetWords ||
      body.nombreMots ||
      project.targetWords ||
      300
    );

    if (!subject) {
      return res.status(400).json({
        error: "Le sujet du travail est obligatoire."
      });
    }

    const safeTargetWords = Math.min(
      Math.max(Number.isFinite(targetWords) ? targetWords : 300, 200),
      500
    );

    const systemPrompt = `
Tu es un rédacteur académique spécialisé dans la rédaction d'introductions
pour les mémoires, rapports, thèses et travaux universitaires.

Ta mission consiste exclusivement à produire un aperçu d'introduction
académique incomplet d'environ ${safeTargetWords} mots.

Cette introduction doit :

1. Présenter clairement le sujet du travail.
2. Contextualiser le thème à partir des informations fournies.
3. Montrer l'intérêt académique ou pratique du sujet.
4. Faire apparaître progressivement la problématique.
5. Préparer la suite de l'introduction sans la terminer complètement.
6. Donner envie de poursuivre la lecture.
7. Rester cohérente avec le niveau d'études et le type de document.
8. Utiliser uniquement les informations réellement fournies par l'utilisateur.
9. Ne pas imposer de pays, de ville, d'institution, de terrain ou de secteur
   géographique non mentionné par l'utilisateur.
10. Ne jamais inventer de statistiques, de résultats, d'enquêtes,
    d'auteurs, de références ou de données.
11. Ne pas produire une conclusion complète.
12. Ne pas présenter cet aperçu comme une introduction finale terminée.

STYLE RÉDACTIONNEL :

- Style académique, rigoureux, naturel et dynamique.
- Vocabulaire précis et adapté au sujet.
- Paragraphes cohérents et correctement articulés.
- Une idée principale par paragraphe.
- Transitions naturelles et modérées.
- Éviter la répétition des mêmes expressions.
- Éviter l'utilisation abusive de « en effet », « de plus » et « cependant ».
- Éviter les clichés rédactionnels associés aux textes générés par IA.
- Éviter les formulations artificielles, mécaniques ou trop générales.
- Éviter les phrases inutilement longues ou difficiles à comprendre.
- Une longueur de 28 mots maximum par phrase est une recommandation stylistique,
  et non une règle bloquante.
- Une phrase légèrement plus longue peut être conservée si elle reste claire,
  grammaticale et pertinente.
- Ne pas bloquer la rédaction en raison de la longueur d'une phrase.
- Ne pas exiger une citation dans chaque paragraphe.
- Ne pas inventer de citation pour donner une apparence académique au texte.
- Développer les acronymes lors de leur première apparition.
- Respecter les consignes particulières transmises par l'utilisateur.

L'introduction doit rester partielle. Elle doit ouvrir le travail et préparer
la poursuite de la rédaction, sans fournir une introduction complète et définitive.
`;

    const userPrompt = `
Rédige un aperçu d'introduction académique incomplet.

INFORMATIONS DU PROJET :

Sujet :
${subject}

Domaine :
${domain || "Non précisé"}

Niveau d'études :
${level || "Non précisé"}

Type de document :
${documentType || "Non précisé"}

Formule choisie :
${formula || "Non précisée"}

Contexte fourni par l'utilisateur :
${context || "Aucun contexte supplémentaire fourni"}

Consignes de l'utilisateur :
${instructions || "Aucune consigne supplémentaire fournie"}

Problématique sélectionnée :
${problematic || "À construire progressivement à partir du sujet fourni"}

Plan sélectionné :
${plan ? JSON.stringify(plan, null, 2) : "Aucun plan fourni"}

LONGUEUR DEMANDÉE :
Environ ${safeTargetWords} mots.

CONSIGNES FINALES :

- Rédige uniquement l'aperçu de l'introduction.
- Ne rédige pas le développement complet.
- Ne rédige pas la conclusion générale.
- Ne crée pas de fausses références.
- N'ajoute aucune information géographique ou institutionnelle non fournie.
- Maintiens une progression logique vers la problématique.
- Termine l'aperçu de manière ouverte afin de permettre la poursuite
  de l'introduction dans une étape ultérieure.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
          temperature: 0.6,
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
              name: "introduction_preview_response",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  introduction: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: {
                        type: "string"
                      },
                      content: {
                        type: "string"
                      },
                      wordCount: {
                        type: "integer"
                      },
                      incomplete: {
                        type: "boolean"
                      }
                    },
                    required: [
                      "title",
                      "content",
                      "wordCount",
                      "incomplete"
                    ]
                  }
                },
                required: [
                  "introduction"
                ]
              }
            }
          }
        })
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      let errorDetails = responseText;

      try {
        const parsedError = JSON.parse(responseText);
        errorDetails =
          parsedError?.error?.message ||
          parsedError?.message ||
          responseText;
      } catch {
        // Le contenu de l'erreur reste inchangé.
      }

      return res.status(response.status).json({
        error: "Erreur lors de l'appel à l'API OpenAI.",
        details: errorDetails
      });
    }

    const data = JSON.parse(responseText);
    const outputText = extractOutputText(data);

    if (!outputText) {
      return res.status(502).json({
        error: "Aucun contenu n'a été retourné par l'API OpenAI."
      });
    }

    const result = parseJsonResponse(outputText);

    const introduction = result?.introduction;

    if (!introduction || !introduction.content?.trim()) {
      return res.status(502).json({
        error: "L'introduction générée est vide ou invalide."
      });
    }

    return res.status(200).json({
      introduction: {
        title:
          normalizeText(introduction.title) ||
          "Aperçu de l'introduction",
        content: introduction.content.trim(),
        wordCount:
          Number.isInteger(introduction.wordCount)
            ? introduction.wordCount
            : introduction.content.trim().split(/\s+/).length,
        incomplete: true
      }
    });
  } catch (error) {
    console.error(
      "Erreur generate-introduction-preview:",
      error
    );

    return res.status(500).json({
      error: "Une erreur interne est survenue.",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
}
