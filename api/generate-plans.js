
const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function extractDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");

  if (!match) return null;

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function uploadFiles(files, apiKey) {
  const ids = [];

  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.content) continue;

    const decoded = extractDataUrl(file.content);

    if (!decoded) continue;

    const form = new FormData();

    form.append("purpose", "user_data");

    form.append(
      "file",
      new Blob([decoded.buffer], {
        type: decoded.mime || file.type || "application/octet-stream",
      }),
      file.name || "document"
    );

    const response = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text();

      throw fail(
        `Impossible de transmettre le fichier ${file.name || "document"}. ${detail}`,
        502
      );
    }

    const data = await response.json();

    if (data.id) {
      ids.push(data.id);
    }
  }

  return ids;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function detectCitationMode(project) {
  const source = normalizeText(
    `${project?.consignes || ""} ${project?.contexte || ""}`
  );

  return /(note de bas de page|notes de bas de page|footnotes?|notes bibliographiques)/.test(
    source
  )
    ? "footnotes"
    : "apa";
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];

  const texts = [];

  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;

    for (const content of item.content) {
      if (typeof content?.text === "string") {
        texts.push(content.text);
      }
    }
  }

  const result = texts.join("\n").trim();

  if (!result) {
    throw fail(
      "La réponse du modèle ne contient aucun contenu exploitable.",
      502
    );
  }

  return result;
}

function buildProjectContext(project, problematic, citationMode, expectedWords) {
  const sujet = project?.sujet || project?.subject || "";
  const domaine = project?.domaine || project?.domain || "";
  const niveau = project?.niveau || project?.level || "";
  const typeDocument =
    project?.typeDocument || project?.typeDoc || project?.type || "";
  const formule = project?.formule || project?.formula || "";
  const contexte = project?.contexte || project?.context || "";
  const consignes = project?.consignes || project?.instructions || "";

  return `
DONNÉES DU PROJET

Sujet :
${sujet}

Domaine :
${domaine}

Niveau académique :
${niveau}

Type de document :
${typeDocument}

Formule :
${formule}

Contexte fourni par l'utilisateur :
${contexte}

Consignes fournies par l'utilisateur :
${consignes}

Problématique sélectionnée :
${problematic || "Aucune problématique sélectionnée."}

Style de citation :
${citationMode}

Volume théorique demandé :
${expectedWords} mots.

RÈGLE ABSOLUE :
Utilise uniquement les informations réellement fournies.
N'impose aucun pays, aucune ville, aucune institution, aucune organisation
et aucun terrain absent des données de l'utilisateur.
`;
}

const SYSTEM_PROMPT = `
Tu es un concepteur de plans académiques spécialisé dans les mémoires,
rapports, thèses et travaux universitaires.

Ta mission consiste à créer des plans variés, cohérents et adaptés au sujet.

OBJECTIF PRINCIPAL

Produire plusieurs plans réellement différents lorsque plusieurs plans sont demandés.
La variation doit concerner :

- l'angle d'analyse ;
- l'ordre logique des axes ;
- la progression théorique, institutionnelle, empirique ou critique ;
- la place des concepts ;
- l'organisation des chapitres ;
- la relation entre les parties ;
- la manière de traiter la problématique.

Ne produis jamais trois plans identiques avec des titres légèrement modifiés.

STRUCTURE ACADÉMIQUE OBLIGATOIRE

Chaque plan doit contenir :

1. Une introduction générale.

2. Deux ou trois parties principales.

3. Chaque partie doit contenir un ou plusieurs chapitres pertinents.

4. Chaque chapitre doit contenir entre deux et trois sections.

5. Chaque section doit contenir entre deux et trois sous-sections.

6. Une conclusion générale.

La troisième partie est facultative.
Elle doit être créée uniquement si le sujet et la problématique la justifient.

Les trois sections ne sont pas obligatoires.
N'ajoute une troisième section que si elle apporte une réelle valeur analytique.

La troisième sous-section est facultative.
Ne l'ajoute que si elle est nécessaire à la cohérence du développement.

RÈGLES DE VARIATION

Pour chaque plan :

- Choisis une logique de construction identifiable.
- Évite les titres génériques et répétitifs.
- Évite les plans mécaniques.
- Évite les chapitres qui reprennent simplement les titres des parties.
- Évite les sections qui répètent le contenu des chapitres.
- Évite les sous-sections artificielles.
- Adapte le nombre de chapitres à la complexité du sujet.
- Ne force pas trois parties lorsque deux parties suffisent.
- Ne force pas trois sections lorsque deux sections suffisent.
- Ne force pas trois sous-sections lorsque deux suffisent.

EXEMPLES DE LOGIQUES POSSIBLES

Ces logiques sont indicatives.
Choisis celle qui correspond réellement au sujet.

- Fondements théoriques, analyse des mécanismes, discussion critique.
- Construction du phénomène, manifestations, limites et perspectives.
- Cadre conceptuel, fonctionnement des acteurs, enjeux et recommandations.
- Évolution historique, réalités contemporaines, transformations possibles.
- Déterminants, effets, stratégies et conditions de réussite.
- Cadre institutionnel, pratiques observées, tensions et perspectives.

Ne reproduis pas systématiquement ces modèles.
Crée une structure adaptée au contenu réel du projet.

INTRODUCTION GÉNÉRALE

L'introduction générale doit comporter :

- une présentation du sujet ;
- sa contextualisation selon les informations disponibles ;
- l'intérêt scientifique ou professionnel ;
- la délimitation du sujet ;
- la problématique ;
- les objectifs ou hypothèses lorsque les données les justifient ;
- l'annonce de la structure.

Ne rédige pas l'introduction.
Retourne uniquement son titre, sa description et son volume indicatif.

CONCLUSION GÉNÉRALE

La conclusion générale doit comporter :

- le bilan des axes étudiés ;
- les éléments de réponse à la problématique ;
- les limites possibles ;
- les ouvertures pertinentes.

Ne rédige pas la conclusion.
Retourne uniquement son titre, sa description et son volume indicatif.

STYLE

- Utilise un français académique clair et naturel.
- Varie les formulations.
- Utilise un vocabulaire précis.
- Évite les clichés générés automatiquement.
- Évite les répétitions.
- Une longueur de 28 mots par phrase constitue une recommandation stylistique.
- Une légère variation ne doit jamais entraîner un rejet automatique.
- Ne bloque pas un plan à cause de la longueur d'une phrase.
- Ne force pas les connecteurs logiques.
- Ne produis pas de contenu passe-partout.
- Ne fabrique aucune donnée.
- Ne fabrique aucune référence.
- Ne fabrique aucun terrain.
- Ne fabrique aucune institution.
- Définis les sigles lors de leur première utilisation.
- Respecte le style APA par défaut.
- Utilise les notes de bas de page si les consignes l'exigent.

IMPORTANT

Le plan doit être spécifique au sujet transmis.
Les titres doivent présenter une véritable progression intellectuelle.
Les sections et sous-sections doivent développer des idées distinctes.
Retourne uniquement un JSON conforme au schéma demandé.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    plans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
          },
          title: {
            type: "string",
          },
          description: {
            type: "string",
          },
          approach: {
            type: "string",
          },
          totalWords: {
            type: "integer",
          },
          introductionGeneral: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: {
                type: "string",
              },
              description: {
                type: "string",
              },
              wordCount: {
                type: "integer",
              },
            },
            required: ["title", "description", "wordCount"],
          },
          parts: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: {
                  type: "string",
                },
                number: {
                  type: "integer",
                },
                title: {
                  type: "string",
                },
                description: {
                  type: "string",
                },
                chapters: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: {
                        type: "string",
                      },
                      number: {
                        type: "integer",
                      },
                      title: {
                        type: "string",
                      },
                      description: {
                        type: "string",
                      },
                      wordCount: {
                        type: "integer",
                      },
                      sections: {
                        type: "array",
                        minItems: 2,
                        maxItems: 3,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            id: {
                              type: "string",
                            },
                            number: {
                              type: "integer",
                            },
                            title: {
                              type: "string",
                            },
                            description: {
                              type: "string",
                            },
                            subsections: {
                              type: "array",
                              minItems: 2,
                              maxItems: 3,
                              items: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                  id: {
                                    type: "string",
                                  },
                                  number: {
                                    type: "integer",
                                  },
                                  title: {
                                    type: "string",
                                  },
                                  description: {
                                    type: "string",
                                  },
                                },
                                required: [
                                  "id",
                                  "number",
                                  "title",
                                  "description",
                                ],
                              },
                            },
                          },
                          required: [
                            "id",
                            "number",
                            "title",
                            "description",
                            "subsections",
                          ],
                        },
                      },
                    },
                    required: [
                      "id",
                      "number",
                      "title",
                      "description",
                      "wordCount",
                      "sections",
                    ],
                  },
                },
              },
              required: [
                "id",
                "number",
                "title",
                "description",
                "chapters",
              ],
            },
          },
          conclusionGeneral: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: {
                type: "string",
              },
              description: {
                type: "string",
              },
              wordCount: {
                type: "integer",
              },
            },
            required: ["title", "description", "wordCount"],
          },
        },
        required: [
          "id",
          "title",
          "description",
          "approach",
          "totalWords",
          "introductionGeneral",
          "parts",
          "conclusionGeneral",
        ],
      },
    },
  },
  required: ["plans"],
};

async function generatePlans({
  project,
  problematic,
  apiKey,
  fileIds,
  count,
  expectedWords,
}) {
  const files = fileIds.map((id) => ({
    type: "input_file",
    file_id: id,
  }));

  const citationMode = detectCitationMode(project);

  const userPrompt = `
${buildProjectContext(
  project,
  problematic,
  citationMode,
  expectedWords
)}

NOMBRE DE PLANS DEMANDÉS : ${count}

Génère ${count} plan(s) complet(s).

Si trois plans sont demandés :
- le premier doit suivre une logique d'analyse adaptée au sujet ;
- le deuxième doit présenter une organisation intellectuelle différente ;
- le troisième doit proposer une autre progression pertinente.

Les différences doivent être visibles dans :
- les parties ;
- les chapitres ;
- les sections ;
- les sous-sections ;
- l'ordre des axes ;
- l'approche générale.

Chaque plan doit respecter les règles suivantes :

- introduction générale ;
- deux ou trois parties ;
- chapitres pertinents dans chaque partie ;
- deux ou trois sections par chapitre ;
- deux ou trois sous-sections par section ;
- conclusion générale ;
- aucune structure artificielle ;
- aucune répétition inutile ;
- aucun contenu hors sujet.

Le volume indicatif total est de ${expectedWords} mots.

Répartis le volume de manière cohérente entre les chapitres.
Les volumes sont indicatifs et peuvent être ajustés selon l'importance des axes.

Retourne uniquement le JSON.
`;

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          name: "trimemo_structured_plans",
          strict: true,
          schema: SCHEMA,
        },
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: SYSTEM_PROMPT,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userPrompt,
            },
            ...files,
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw fail(
      `OpenAI a refusé la génération des plans. ${detail}`,
      502
    );
  }

  return extractResponseText(await response.json());
}

function validatePlans(text, count) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail(
      "La réponse OpenAI n'a pas le format JSON attendu.",
      502
    );
  }

  if (!Array.isArray(parsed?.plans)) {
    throw fail(
      "OpenAI n'a pas retourné de liste de plans.",
      502
    );
  }

  const expectedCount = count === 1 ? 1 : 3;

  if (parsed.plans.length < expectedCount) {
    throw fail(
      `OpenAI devait retourner ${expectedCount} plan(s).`,
      502
    );
  }

  return parsed.plans.slice(0, expectedCount);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée.",
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY est absente du serveur.",
    });
  }

  try {
    const body = req.body || {};
    const project = body.project || body;

    const count = Number(body.count) === 1 ? 1 : 3;

    const problematic =
      body.problematic ||
      body.problematique ||
      body.selectedProblematic ||
      "";

    const pages = Math.max(
      1,
      Number(
        project.pages ||
          project.pageCount ||
          project.nombrePages ||
          30
      )
    );

    const expectedWords = pages * WORDS_PER_PAGE;

    const sujet = String(
      project.sujet || project.subject || ""
    ).trim();

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet est obligatoire.",
      });
    }

    const fileIds = await uploadFiles(
      project.files,
      apiKey
    );

    const rawPlans = await generatePlans({
      project,
      problematic,
      apiKey,
      fileIds,
      count,
      expectedWords,
    });

    const plans = validatePlans(rawPlans, count);

    return res.status(200).json({
      plans,
      count: plans.length,
      structure: {
        introductionGeneral: true,
        parts: {
          minimum: 2,
          maximum: 3,
        },
        sectionsPerChapter: {
          minimum: 2,
          maximum: 3,
        },
        subsectionsPerSection: {
          minimum: 2,
          maximum: 3,
        },
        conclusionGeneral: true,
      },
    });
  } catch (error) {
    console.error("Erreur generate-plans:", error);

    const status =
      Number.isInteger(error?.status) ? error.status : 500;

    return res.status(status).json({
      error:
        error?.message ||
        "Une erreur est survenue pendant la génération des plans.",
    });
  }
}
