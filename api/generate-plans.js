
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

function extractText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  const text = Array.isArray(data?.output)
    ? data.output
        .filter((item) => item?.type === "message")
        .flatMap((item) =>
          Array.isArray(item.content) ? item.content : []
        )
        .filter(
          (part) =>
            part?.type === "output_text" &&
            typeof part.text === "string"
        )
        .map((part) => part.text)
        .join("")
        .trim()
    : "";

  if (!text) {
    throw fail(
      "La réponse OpenAI ne contient aucun texte exploitable.",
      502
    );
  }

  return text;
}

function extractDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");

  if (!match) {
    return null;
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function uploadFiles(files, apiKey) {
  const ids = [];

  for (const file of Array.isArray(files) ? files : []) {
    const decoded = extractDataUrl(file?.content);

    if (!decoded) {
      continue;
    }

    const form = new FormData();

    form.append("purpose", "user_data");

    form.append(
      "file",
      new Blob(
        [decoded.buffer],
        {
          type:
            decoded.mime ||
            file.type ||
            "application/octet-stream",
        }
      ),
      file.name || "document"
    );

    const response = await fetch(
      "https://api.openai.com/v1/files",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      }
    );

    if (!response.ok) {
      throw fail(
        `Impossible de transmettre ${
          file.name || "le fichier"
        } à OpenAI. ${await response.text()}`,
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

const subsectionSchema = {
  type: "array",
  minItems: 1,
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
};

const sectionSchema = {
  type: "array",
  minItems: 1,
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
      subsections: subsectionSchema,
    },
    required: [
      "id",
      "number",
      "title",
      "description",
      "subsections",
    ],
  },
};

const chapterSchema = {
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
      sections: sectionSchema,
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
};

const partSchema = {
  type: "array",
  minItems: 1,
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
      chapters: chapterSchema,
    },
    required: [
      "id",
      "number",
      "title",
      "description",
      "chapters",
    ],
  },
};

const introConclusionSchema = {
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
  required: [
    "title",
    "description",
    "wordCount",
  ],
};

const SCHEMA = {
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
          introductionGeneral: introConclusionSchema,
          parts: partSchema,
          conclusionGeneral: introConclusionSchema,
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

function validatePlan(plan, expectedWords, index) {
  if (
    !plan ||
    !Array.isArray(plan.parts) ||
    plan.parts.length < 1 ||
    plan.parts.length > 3
  ) {
    throw fail(
      `Le plan ${index + 1} doit contenir entre 1 et 3 parties.`,
      502
    );
  }

  let chapterWords = 0;

  for (const part of plan.parts) {
    if (
      !Array.isArray(part.chapters) ||
      part.chapters.length === 0
    ) {
      throw fail(
        `La partie ${
          part.number || ""
        } du plan ${index + 1} ne contient aucun chapitre.`,
        502
      );
    }

    for (const chapter of part.chapters) {
      if (
        !Array.isArray(chapter.sections) ||
        chapter.sections.length < 1 ||
        chapter.sections.length > 3
      ) {
        throw fail(
          `Le chapitre ${
            chapter.title || ""
          } doit contenir entre 1 et 3 sections.`,
          502
        );
      }

      if (
        !Number.isInteger(chapter.wordCount) ||
        chapter.wordCount <= 0
      ) {
        throw fail(
          `Le volume du chapitre ${
            chapter.title || ""
          } est invalide.`,
          502
        );
      }

      chapterWords += chapter.wordCount;

      for (const section of chapter.sections) {
        if (
          !Array.isArray(section.subsections) ||
          section.subsections.length < 1 ||
          section.subsections.length > 3
        ) {
          throw fail(
            `La section ${
              section.title || ""
            } doit contenir entre 1 et 3 sous-sections.`,
            502
          );
        }
      }
    }
  }

  if (
    expectedWords > 0 &&
    chapterWords !== expectedWords
  ) {
    throw fail(
      `Le plan ${
        index + 1
      } totalise ${chapterWords} mots au lieu de ${expectedWords}.`,
      502
    );
  }

  return {
    ...plan,
    totalWords:
      expectedWords ||
      Number(plan.totalWords || chapterWords),
  };
}

function buildContext(project, problematic, providedPlan = "") {
  return `
SUJET EXACT :
${project.sujet || ""}

DOMAINE :
${project.domaine || ""}

NIVEAU D'ÉTUDES :
${project.niveau || ""}

TYPE DE DOCUMENT :
${project.typeDoc || project.typeDocument || ""}

CONTEXTE FOURNI :
${project.contexte || project.context || ""}

CONSIGNES FOURNIES :
${project.consignes || project.instructions || ""}

PROBLÉMATIQUE RETENUE :
${JSON.stringify(problematic || {}, null, 2)}

PLAN FOURNI PAR LE CLIENT (FACULTATIF) :
${providedPlan || "Aucun plan fourni"}

VOLUME DEMANDÉ :
${Number(project.pages || 0) * WORDS_PER_PAGE} mots.

BASE DE CALCUL :
320 mots par page.
`;
}

function buildSystemPrompt() {
  return `
Tu es le moteur de conception des plans académiques de Trimémo.

OBJECTIF :
Produire des plans universitaires précis, cohérents, variés
et directement liés au sujet soumis par l'utilisateur.

RÈGLES ABSOLUES :

1. Utilise uniquement les informations présentes dans :
   - Le sujet.
   - Le domaine.
   - Le niveau d'études.
   - Le contexte.
   - Les consignes.
   - Les fichiers transmis.
   - La problématique retenue.

2. N'ajoute pas :
   - De pays non mentionné.
   - D'institution non mentionnée.
   - De terrain non mentionné.
   - De population non mentionnée.
   - De période non mentionnée.
   - De réglementation non mentionnée.
   - De résultat d'enquête inventé.
   - De source ou de référence inventée.

3. Respecte strictement le sujet exact.
   Ne remplace pas le sujet par un sujet plus général.

4. Respecte la problématique retenue.
   Chaque partie du plan doit contribuer à son traitement.

5. Génère exactement le nombre de plans demandé.

6. Les plans doivent varier par leur angle d'analyse :
   - Approche théorique et conceptuelle.
   - Approche analytique et explicative.
   - Approche stratégique, empirique ou opérationnelle,
     uniquement lorsque le sujet le permet.

7. Ne modifie pas artificiellement le sujet pour créer
   des différences entre les plans.

8. Chaque plan doit comporter :
   - Une introduction générale.
   - Deux ou trois parties.
   - Des chapitres cohérents dans chaque partie.
   - Une à trois sections par chapitre.
   - Une à trois sous-sections par section.
   - Une conclusion générale.

9. Une troisième partie est autorisée uniquement si
   la complexité du sujet la justifie.

10. Chaque titre doit être spécifique au sujet.
    Évite les titres génériques et interchangeables.

11. Chaque description doit expliquer la fonction
    analytique du niveau concerné.

12. Attribue un volume de mots positif à chaque chapitre.

13. La somme des volumes des chapitres doit correspondre
    exactement au volume demandé.

14. Le volume de l'introduction et de la conclusion
    ne doit pas être ajouté au total des chapitres,
    sauf si cela est explicitement demandé.

15. Rédige des intitulés académiques clairs et précis.

16. Utilise une formulation naturelle et professionnelle.
    Évite les répétitions et les formulations mécaniques.

17. Ne rédige pas le mémoire.
    Génère uniquement sa structure détaillée.

18. Retourne uniquement le JSON conforme au schéma fourni.
`;
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
  const model = process.env.OPENAI_MODEL;

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY est absente du serveur.",
    });
  }

  if (!model) {
    return res.status(500).json({
      error:
        "OPENAI_MODEL est absente du serveur. Ajoutez le modèle OpenAI dans les variables d'environnement.",
    });
  }

  try {
    const body = req.body || {};

    const project = body.project || body;

    const problematic =
      body.problematic ||
      body.problematique ||
      project.problematiquePersonnelle ||
      {};
    const providedPlan = String(
      body.providedPlan ||
      project.planPersonnel ||
      ""
    ).trim();

    const count =
      Number(body.count) === 1 ? 1 : 3;

    const pages = Number(project.pages || 0);

    const sujet = String(project.sujet || "").trim();

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet est obligatoire.",
      });
    }

    if (!Number.isInteger(pages) || pages <= 0) {
      return res.status(400).json({
        error: "Le nombre de pages est invalide.",
      });
    }

    const expectedWords = pages * WORDS_PER_PAGE;

    const fileIds = await uploadFiles(
      project.files,
      apiKey
    );

    const fileInputs = fileIds.map((id) => ({
      type: "input_file",
      file_id: id,
    }));

    const response = await fetch(OPENAI_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },

      body: JSON.stringify({
        model,

        tools: [
          {
            type: "web_search",
          },
        ],

        text: {
          format: {
            type: "json_schema",
            name: "trimemo_plans_structure",
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
                text: buildSystemPrompt(),
              },
            ],
          },

          {
            role: "user",

            content: [
              {
                type: "input_text",

                text: `
${buildContext(project, problematic, providedPlan)}

INSTRUCTIONS DE PRODUCTION :

Génère exactement ${count} plan(s).

${providedPlan ? `Un plan a été fourni par le client. Reprends-en fidèlement la logique et les intitulés utiles. Ne crée pas un autre plan à sa place. Structure-le uniquement pour le rendre exploitable par la rédaction.` : `Les trois plans doivent avoir des structures internes réellement variées, sans modèle fixe 2 x 2 x 2.`}

La somme des volumes des chapitres
doit être exactement de ${expectedWords} mots.

Le nombre de parties doit être compris
entre 1 et 3.

Chaque chapitre peut comporter de 1 à 3 sections.
Chaque section peut comporter de 1 à 3 sous-sections.
Ne force jamais le même nombre de chapitres, de sections
et de sous-sections dans les trois plans.
La structure doit varier lorsque la logique scientifique
du sujet le justifie. La variation doit être argumentée
par l'approche du plan, jamais aléatoire.
Si un plan est fourni par le client, conserve sa logique
et transforme uniquement sa structure en JSON exploitable.

Ne change pas le sujet fourni.

Retourne uniquement le JSON demandé.
`,
              },

              ...fileInputs,
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw fail(
        `OpenAI a refusé la génération des plans. ${await response.text()}`,
        502
      );
    }

    const responseData = await response.json();

    const parsed = JSON.parse(
      extractText(responseData)
    );

    if (
      !Array.isArray(parsed.plans) ||
      parsed.plans.length < count
    ) {
      throw fail(
        `OpenAI devait retourner ${count} plan(s).`,
        502
      );
    }

    const plans = parsed.plans
      .slice(0, count)
      .map((plan, index) =>
        validatePlan(
          plan,
          expectedWords,
          index
        )
      );

    return res.status(200).json({
      plans,
    });
  } catch (error) {
    console.error(
      "generate-plans error",
      error
    );

    return res.status(error.status || 500).json({
      error:
        error.message ||
        "Erreur interne lors de la génération des plans.",
    });
  }
}
