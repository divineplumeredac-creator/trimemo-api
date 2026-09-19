const STYLE_RULES = `
STYLE ACADÉMIQUE OBLIGATOIRE

1. Rigueur et dynamisme.
- Propos clairs.
- Vocabulaire précis et varié.
- Articulation logique.
- Aucun remplissage.

2. LONGUEUR DES PHRASES
- Maximum absolu : 20 mots par phrase.
- Toute phrase dépassant 20 mots est interdite.
- Privilégier les phrases courtes et autonomes.
- Éviter les enchâssements et les formulations hermétiques.

3. INTERDICTIONS FORMELLES
- Pas de connecteurs abusifs.
- Éviter les répétitions de « en effet », « de plus » et « cependant ».
- Interdire « parce que », « afin de » et « dans le but de ».
- Éviter l'accumulation de « ceci » et « cela ».
- Éviter les prépositions en cascade.
- Limiter les adverbes en -ment.
- Interdire les clichés et formulations automatisées.
- Interdire les constructions symétriques artificielles.
- Éviter les répétitions, redondances et parallélismes.
- Ne pas produire de plan tiroir.
- Ne pas produire une structure mécanique ou prévisible.

4. EXPRESSIONS IA INTERDITES
Ne jamais employer :
« Dans un monde en constante évolution »
« Il est important de noter »
« Il devient crucial »
« En conclusion »
« Force est de constater »
« Il convient de noter »
« Il convient de souligner »
« Il est intéressant de noter »
« Dans cette optique »
« Dans cette perspective »
« Au regard de ce qui précède »
« En définitive »
« En somme »
« Dans le contexte actuel »
« À l'ère de »
« constitue un enjeu majeur »
« joue un rôle majeur »
« joue un rôle clé »
« s'avère être »
« permet de mieux comprendre »
« il importe de »
« il est essentiel de »
Toute formulation proche doit être reformulée.

5. SIGLES
- Définir chaque sigle à sa première occurrence.
- Exemple : RBV (Resource-Based View).
- Exemple : OCDE (Organisation de Coopération et de Développement Économiques).

6. STRUCTURE
- Éviter les structures mécaniques.
- Éviter les plans tiroirs.
- Chaque partie doit avoir une fonction analytique claire.
- Les sous-parties doivent découler du sujet.

7. CITATIONS
- APA par défaut.
- Citation : (Auteur, année).
- Citation avec page : (Auteur, année, p. xx).
- Ne jamais inventer une référence.
`;

const OPENAI_URL =
  "https://api.openai.com/v1/responses";

const WORDS_PER_PAGE = 320;

function cors(res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );
}

function fail(
  message,
  status = 400
) {
  const error =
    new Error(message);

  error.status = status;

  return error;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function splitSentences(value) {
  return String(value || "")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"'])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getStyleViolations(value) {
  const text =
    String(value || "").trim();

  const normalized =
    normalizeText(text);

  const violations = [];

  const forbidden = [
    "dans un monde en constante evolution",
    "il est important de noter",
    "il devient crucial",
    "en conclusion",
    "force est de constater",
    "il convient de noter",
    "il convient de souligner",
    "il est interessant de noter",
    "dans cette optique",
    "dans cette perspective",
    "au regard de ce qui precede",
    "en definitive",
    "en somme",
    "dans le contexte actuel",
    "a l'ere de",
    "constitue un enjeu majeur",
    "joue un role majeur",
    "joue un role cle",
    "s'avere etre",
    "permet de mieux comprendre",
    "il importe de",
    "il est essentiel de",
    "afin de",
    "dans le but de",
    "parce que"
  ];

  for (
    const phrase of forbidden
  ) {
    if (
      normalized.includes(phrase)
    ) {
      violations.push(
        `Expression interdite : "${phrase}"`
      );
    }
  }

  const ceciCela =
    normalized.match(
      /\b(ceci|cela)\b/g
    ) || [];

  if (ceciCela.length > 1) {
    violations.push(
      "Abondance de « ceci » ou « cela »."
    );
  }

  for (
    const sentence of
    splitSentences(text)
  ) {
    const words =
      countWords(sentence);

    if (words > 20) {
      violations.push(
        `Phrase de ${words} mots. Maximum : 20.`
      );
    }
  }

  return violations;
}

function assertStyle(
  value,
  label
) {
  const violations =
    getStyleViolations(value);

  if (violations.length) {
    throw fail(
      `${label} ne respecte pas le style : ${violations.join(" | ")}`,
      502
    );
  }
}

function extractDataUrl(
  dataUrl
) {
  const match =
    /^data:([^;]+);base64,(.+)$/s.exec(
      dataUrl || ""
    );

  if (!match) return null;

  return {
    mime: match[1],
    buffer:
      Buffer.from(
        match[2],
        "base64"
      )
  };
}

async function uploadFiles(
  files,
  apiKey
) {
  const ids = [];

  for (
    const file of Array.isArray(
      files
    )
      ? files
      : []
  ) {
    if (!file?.content)
      continue;

    const decoded =
      extractDataUrl(
        file.content
      );

    if (!decoded)
      continue;

    const form =
      new FormData();

    form.append(
      "purpose",
      "user_data"
    );

    form.append(
      "file",
      new Blob(
        [decoded.buffer],
        {
          type:
            decoded.mime ||
            file.type ||
            "application/octet-stream"
        }
      ),
      file.name ||
        "document"
    );

    const response =
      await fetch(
        "https://api.openai.com/v1/files",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`
          },

          body: form
        }
      );

    if (!response.ok) {
      const detail =
        await response.text();

      throw fail(
        `Impossible de transmettre ${
          file.name ||
          "le fichier"
        } à OpenAI. ${detail}`,
        502
      );
    }

    const data =
      await response.json();

    if (data.id)
      ids.push(data.id);
  }

  return ids;
}

function extractResponseText(
  data
) {
  if (
    typeof data?.output_text ===
      "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  if (
    data?.status ===
    "incomplete"
  ) {
    throw fail(
      `La réponse OpenAI est incomplète : ${
        data?.incomplete_details
          ?.reason ||
        "raison inconnue"
      }.`,
      502
    );
  }

  const parts =
    Array.isArray(data?.output)
      ? data.output
          .filter(
            (item) =>
              item?.type ===
              "message"
          )
          .flatMap((item) =>
            Array.isArray(
              item.content
            )
              ? item.content
              : []
          )
          .filter(
            (part) =>
              part?.type ===
                "output_text" &&
              typeof part.text ===
                "string"
          )
          .map(
            (part) =>
              part.text
          )
      : [];

  const text =
    parts.join("").trim();

  if (!text) {
    throw fail(
      "La réponse OpenAI ne contient aucun texte exploitable.",
      502
    );
  }

  return text;
}

function buildContext(
  project,
  problematic
) {
  const pages =
    Number(
      project?.pages || 0
    );

  return `
SUJET EXACT :
${project?.sujet || ""}

CONTEXTE :
${project?.contexte || ""}

CONSIGNES :
${project?.consignes || ""}

NIVEAU :
${project?.niveau || ""}

TYPE DE DOCUMENT :
${project?.typeDoc || ""}

FORMULE :
${project?.formula || ""}

VOLUME :
${pages} page(s)

VOLUME TOTAL :
${pages * WORDS_PER_PAGE} mots

PROBLÉMATIQUE :
${JSON.stringify(
  problematic || {},
  null,
  2
)}
`;
}

const SYSTEM_PROMPT = `
Tu es le moteur de conception de plans académiques de Trimémo.

${STYLE_RULES}

RÈGLES DE FOND :

1. Le plan naît du sujet et de la problématique.
2. Ne jamais imposer un pays, une ville ou une institution.
3. Ne jamais imposer un terrain ou une réglementation.
4. Ne jamais injecter une discipline absente du projet.
5. Ne jamais utiliser un plan préécrit.
6. Ne jamais utiliser de fallback.
7. Ne jamais inventer de données ou de références.
8. Ne jamais produire un plan tiroir.
9. Chaque chapitre doit avoir une fonction analytique identifiable.
10. Les trois plans doivent présenter des angles réellement différents.
11. Le volume total doit être respecté exactement.
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
            type: "string"
          },

          title: {
            type: "string"
          },

          description: {
            type: "string"
          },

          approach: {
            type: "string"
          },

          totalWords: {
            type: "integer"
          },

          chapters: {
            type: "array",

            items: {
              type: "object",
              additionalProperties: false,

              properties: {
                id: {
                  type: "string"
                },

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
                }
              },

              required: [
                "id",
                "title",
                "subparts",
                "wordCount"
              ]
            }
          }
        },

        required: [
          "id",
          "title",
          "description",
          "approach",
          "totalWords",
          "chapters"
        ]
      }
    }
  },

  required: [
    "plans"
  ]
};

async function generatePlans(
  project,
  problematic,
  apiKey,
  fileIds,
  count
) {
  const requestedCount =
    count === 1 ? 1 : 3;

  const pages =
    Number(
      project?.pages || 0
    );

  const expectedWords =
    pages * WORDS_PER_PAGE;

  const files =
    fileIds.map(
      (id) => ({
        type: "input_file",
        file_id: id
      })
    );

  const response =
    await fetch(
      OPENAI_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${apiKey}`
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

          text: {
            format: {
              type: "json_schema",
              name:
                "trimemo_plans",
              strict: true,
              schema: SCHEMA
            }
          },

          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text:
                    SYSTEM_PROMPT
                }
              ]
            },

            {
              role: "user",
              content: [
                {
                  type: "input_text",

                  text: `
${buildContext(
  project,
  problematic
)}

Génère exactement ${requestedCount} plan(s).

Chaque plan doit :

- découler du sujet ;
- découler de la problématique ;
- présenter un angle distinct ;
- éviter les structures mécaniques ;
- éviter les plans tiroirs ;
- respecter la limite de 20 mots par phrase ;
- respecter exactement ${expectedWords} mots.

La somme des wordCount des chapitres doit être exactement ${expectedWords}.

Retourne uniquement le JSON.
`
                },

                ...files
              ]
            }
          ]
        })
      }
    );

  if (!response.ok) {
    const detail =
      await response.text();

    throw fail(
      `OpenAI a refusé la génération des plans. ${detail}`,
      502
    );
  }

  return extractResponseText(
    await response.json()
  );
}

function validatePlans(
  text,
  expectedWords,
  count
) {
  let parsed;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    throw fail(
      "La réponse OpenAI n'a pas le format JSON attendu.",
      502
    );
  }

  if (
    !Array.isArray(
      parsed?.plans
    )
  ) {
    throw fail(
      "OpenAI n'a pas retourné de plans.",
      502
    );
  }

  const expectedCount =
    count === 1 ? 1 : 3;

  if (
    parsed.plans.length <
    expectedCount
  ) {
    throw fail(
      `OpenAI devait retourner ${expectedCount} plan(s).`,
      502
    );
  }

  return parsed.plans
    .slice(0, expectedCount)
    .map(
      (
        plan,
        planIndex
      ) => {
        if (
          !plan?.title ||
          !plan?.description ||
          !Array.isArray(
            plan?.chapters
          )
        ) {
          throw fail(
            `Le plan ${
              planIndex + 1
            } est incomplet.`,
            502
          );
        }

        assertStyle(
          plan.title,
          `Titre du plan ${
            planIndex + 1
          }`
        );

        assertStyle(
          plan.description,
          `Description du plan ${
            planIndex + 1
          }`
        );

        assertStyle(
          plan.approach || "",
          `Approche du plan ${
            planIndex + 1
          }`
        );

        const chapters =
          plan.chapters.map(
            (
              chapter,
              chapterIndex
            ) => {
              const wordCount =
                Number(
                  chapter?.wordCount
                );

              if (
                !chapter?.title ||
                !Array.isArray(
                  chapter?.subparts
                ) ||
                !Number.isFinite(
                  wordCount
                ) ||
                wordCount <= 0
              ) {
                throw fail(
                  `Le chapitre ${
                    chapterIndex + 1
                  } du plan ${
                    planIndex + 1
                  } est invalide.`,
                  502
                );
              }

              assertStyle(
                chapter.title,
                `Titre du chapitre ${
                  chapterIndex + 1
                }`
              );

              chapter.subparts.forEach(
                (
                  subpart,
                  subpartIndex
                ) => {
                  assertStyle(
                    subpart,
                    `Sous-partie ${
                      subpartIndex + 1
                    }`
                  );
                }
              );

              return {
                id:
                  String(
                    chapter.id ||
                      `chapter-${planIndex + 1}-${chapterIndex + 1}`
                  ),

                title:
                  String(
                    chapter.title
                  ).trim(),

                subparts:
                  chapter.subparts
                    .map(
                      (item) =>
                        String(
                          item
                        ).trim()
                    )
                    .filter(
                      Boolean
                    ),

                wordCount
              };
            }
          );

        const total =
          chapters.reduce(
            (
              sum,
              chapter
            ) =>
              sum +
              chapter.wordCount,
            0
          );

        if (
          total !==
          expectedWords
        ) {
          throw fail(
            `Le plan ${
              planIndex + 1
            } totalise ${total} mots au lieu de ${expectedWords}.`,
            502
          );
        }

        return {
          id:
            String(
              plan.id ||
                `plan-${planIndex + 1}`
            ),

          title:
            String(
              plan.title
            ).trim(),

          description:
            String(
              plan.description
            ).trim(),

          approach:
            String(
              plan.approach || ""
            ).trim(),

          totalWords:
            expectedWords,

          chapters
        };
      }
    );
}

export default async function handler(
  req,
  res
) {
  cors(res);

  if (
    req.method === "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  if (
    req.method !== "POST"
  ) {
    return res.status(405).json({
      error:
        "Méthode non autorisée."
    });
  }

  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY est absente du serveur."
    });
  }

  try {
    const body =
      req.body || {};

    const project =
      body.project || body;

    const problematic =
      body.problematic ||
      body.problematique;

    const count =
      Number(body.count) === 1
        ? 1
        : 3;

    if (
      !String(
        project?.sujet || ""
      ).trim()
    ) {
      return res.status(400).json({
        error:
          "Le sujet est obligatoire."
      });
    }

    if (!problematic) {
      return res.status(400).json({
        error:
          "La problématique est obligatoire."
      });
    }

    const pages =
      Number(
        project?.pages || 0
      );

    if (
      !Number.isInteger(pages) ||
      pages <= 0
    ) {
      return res.status(400).json({
        error:
          "Le nombre de pages est invalide."
      });
    }

    const expectedWords =
      pages *
      WORDS_PER_PAGE;

    const fileIds =
      await uploadFiles(
        project.files,
        apiKey
      );

    const output =
      await generatePlans(
        project,
        problematic,
        apiKey,
        fileIds,
        count
      );

    const plans =
      validatePlans(
        output,
        expectedWords,
        count
      );

    return res.status(200).json({
      plans
    });
  } catch (error) {
    const status =
      Number(error?.status) || 500;

    return res.status(status).json({
      error:
        error?.message ||
        "Erreur lors de la génération des plans."
    });
  }
  }
