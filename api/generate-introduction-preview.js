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
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output)
    ? data.output
    : [];

  const texts = [];

  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;

    for (const content of item.content) {
      if (
        typeof content?.text === "string" &&
        content.text.trim()
      ) {
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

    if (
      firstBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      const possibleJson = text.slice(
        firstBrace,
        lastBrace + 1
      );

      return JSON.parse(possibleJson);
    }

    throw new Error(
      "La réponse reçue n'est pas un JSON valide."
    );
  }
}

function getOpenAIErrorMessage(data, rawText) {
  return (
    data?.error?.message ||
    data?.error?.type ||
    data?.message ||
    rawText ||
    "Erreur OpenAI sans détail disponible."
  );
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Méthode non autorisée. Utilisez POST."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error:
        "La variable OPENAI_API_KEY est absente de Vercel.",
      code: "MISSING_OPENAI_API_KEY"
    });
  }

  try {
    const body = req.body || {};

    const project =
      body.project ||
      body.projet ||
      body;

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

    const plan =
      body.plan ||
      project.plan ||
      null;

    const requestedWords = Number(
      body.targetWords ||
      body.nombreMots ||
      project.targetWords ||
      300
    );

    if (!subject) {
      return res.status(400).json({
        success: false,
        error:
          "Le sujet du travail est obligatoire.",
        code: "MISSING_SUBJECT"
      });
    }

    const targetWords = Math.min(
      Math.max(
        Number.isFinite(requestedWords)
          ? requestedWords
          : 300,
        200
      ),
      500
    );

    const systemPrompt = `
Tu es un rédacteur académique spécialisé dans
les mémoires, rapports, thèses et travaux universitaires.

Ta mission consiste exclusivement à rédiger
un aperçu d'introduction académique incomplet
d'environ ${targetWords} mots.

OBJECTIFS DE L'INTRODUCTION :

1. Présenter clairement le sujet.
2. Contextualiser le thème à partir des données fournies.
3. Montrer l'intérêt académique ou pratique du sujet.
4. Faire apparaître progressivement la problématique.
5. Préparer la suite de l'introduction.
6. Maintenir une progression logique.
7. Ne pas produire une introduction complète.
8. Ne pas rédiger la conclusion générale.

RÈGLES DE CONTENU :

- Utilise uniquement les informations fournies.
- N'impose aucun pays, aucune ville ou institution.
- N'invente aucune enquête, statistique ou donnée.
- N'invente aucun auteur ni aucune référence.
- N'invente aucun terrain de recherche.
- Ne présente pas de résultats non fournis.
- Ne termine pas complètement l'introduction.
- Ne remplace pas les informations manquantes par des suppositions.

RÈGLES DE STYLE :

- Style académique, rigoureux et naturel.
- Vocabulaire précis.
- Paragraphes cohérents.
- Une idée principale par paragraphe.
- Transitions naturelles et modérées.
- Évite les répétitions.
- Évite l'utilisation abusive de « en effet »,
  « de plus » et « cependant ».
- Évite les clichés rédactionnels.
- Évite les formulations mécaniques.
- Une longueur de 28 mots par phrase est une
  recommandation stylistique, pas une règle bloquante.
- Une phrase légèrement plus longue peut être conservée
  si elle reste claire et grammaticalement correcte.
- Ne bloque pas la rédaction en raison de la longueur
  d'une phrase.
- Ne force pas une citation dans chaque paragraphe.
- Développe les acronymes à leur première apparition.

L'aperçu doit rester incomplet et préparer
la continuation de l'introduction.
`;

    const userPrompt = `
Rédige un aperçu d'introduction académique incomplet.

INFORMATIONS DU PROJET

Sujet :
${subject}

Domaine :
${domain || "Non précisé"}

Niveau d'études :
${level || "Non précisé"}

Type de document :
${documentType || "Non précisé"}

Formule :
${formula || "Non précisée"}

Contexte fourni :
${context || "Aucun contexte supplémentaire fourni"}

Consignes :
${instructions || "Aucune consigne supplémentaire fournie"}

Problématique :
${problematic || "À construire progressivement à partir du sujet"}

Plan :
${
  plan
    ? JSON.stringify(plan, null, 2)
    : "Aucun plan fourni"
}

LONGUEUR DEMANDÉE :
Environ ${targetWords} mots.

CONSIGNES FINALES :

- Rédige uniquement l'aperçu de l'introduction.
- Ne rédige pas le développement complet.
- Ne rédige pas la conclusion générale.
- Ne crée pas de fausses références.
- N'ajoute pas de contexte géographique non fourni.
- Prépare progressivement la problématique.
- Termine de manière ouverte pour permettre
  la continuation de l'introduction.
`;

    const model =
      process.env.OPENAI_MODEL ||
      "gpt-4o-mini";

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
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

    const rawResponseText =
      await openAIResponse.text();

    let responseData = null;

    try {
      responseData =
        JSON.parse(rawResponseText);
    } catch {
      responseData = null;
    }

    if (!openAIResponse.ok) {
      const errorMessage =
        getOpenAIErrorMessage(
          responseData,
          rawResponseText
        );

      console.error(
        "OPENAI_ERROR",
        JSON.stringify({
          status: openAIResponse.status,
          statusText: openAIResponse.statusText,
          model,
          error: errorMessage,
          response: responseData
        })
      );

      return res.status(502).json({
        success: false,
        error:
          "OpenAI a refusé la requête.",
        code: "OPENAI_API_ERROR",
        status: openAIResponse.status,
        details: errorMessage,
        model
      });
    }

    const outputText =
      extractOutputText(responseData);

    if (!outputText) {
      console.error(
        "OPENAI_EMPTY_RESPONSE",
        JSON.stringify(responseData)
      );

      return res.status(502).json({
        success: false,
        error:
          "OpenAI n'a retourné aucun contenu.",
        code: "EMPTY_OPENAI_RESPONSE",
        model
      });
    }

    let result;

    try {
      result =
        parseJsonResponse(outputText);
    } catch (parseError) {
      console.error(
        "OPENAI_JSON_PARSE_ERROR",
        parseError.message,
        outputText
      );

      return res.status(502).json({
        success: false,
        error:
          "La réponse d'OpenAI n'a pas le format attendu.",
        code: "INVALID_OPENAI_JSON",
        details: parseError.message,
        rawOutput: outputText
      });
    }

    const introduction =
      result?.introduction;

    if (
      !introduction ||
      !normalizeText(introduction.content)
    ) {
      return res.status(502).json({
        success: false,
        error:
          "L'introduction générée est vide.",
        code: "EMPTY_INTRODUCTION"
      });
    }

    const content =
      introduction.content.trim();

    const calculatedWordCount =
      content.split(/\s+/).filter(Boolean).length;

    return res.status(200).json({
      success: true,
      introduction: {
        title:
          normalizeText(introduction.title) ||
          "Aperçu de l'introduction",
        content,
        wordCount:
          Number.isInteger(introduction.wordCount)
            ? introduction.wordCount
            : calculatedWordCount,
        incomplete: true
      }
    });
  } catch (error) {
    console.error(
      "INTRODUCTION_PREVIEW_ERROR",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Une erreur interne est survenue.",
      code: "INTERNAL_SERVER_ERROR",
      details: error.message
    });
  }
                    }
