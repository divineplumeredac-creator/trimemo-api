
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
  const match = /^data:([^;]+);base64,(.+)$/s.exec(
    dataUrl || ""
  );

  if (!match) return null;

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function uploadFiles(files, apiKey) {
  const ids = [];

  for (const file of Array.isArray(files) ? files : []) {
    const decoded = extractDataUrl(file?.content);

    if (!decoded) continue;

    const form = new FormData();

    form.append("purpose", "user_data");

    form.append(
      "file",
      new Blob([decoded.buffer], {
        type:
          decoded.mime ||
          file.type ||
          "application/octet-stream"
      }),
      file.name || "document"
    );

    const response = await fetch(
      "https://api.openai.com/v1/files",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: form
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

    if (data.id) ids.push(data.id);
  }

  return ids;
}

const subsectionSchema = {
  type: "array",
  minItems: 2,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      number: { type: "integer" },
      title: { type: "string" },
      description: { type: "string" }
    },
    required: [
      "id",
      "number",
      "title",
      "description"
    ]
  }
};

const sectionSchema = {
  type: "array",
  minItems: 2,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      number: { type: "integer" },
      title: { type: "string" },
      description: { type: "string" },
      subsections: subsectionSchema
    },
    required: [
      "id",
      "number",
      "title",
      "description",
      "subsections"
    ]
  }
};

const chapterSchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      number: { type: "integer" },
      title: { type: "string" },
      description: { type: "string" },
      wordCount: { type: "integer" },
      sections: sectionSchema
    },
    required: [
      "id",
      "number",
      "title",
      "description",
      "wordCount",
      "sections"
    ]
  }
};

const partSchema = {
  type: "array",
  minItems: 2,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      number: { type: "integer" },
      title: { type: "string" },
      description: { type: "string" },
      chapters: chapterSchema
    },
    required: [
      "id",
      "number",
      "title",
      "description",
      "chapters"
    ]
  }
};

const introductionConclusionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    wordCount: { type: "integer" }
  },
  required: [
    "title",
    "description",
    "wordCount"
  ]
};

const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    approach: { type: "string" },
    totalWords: { type: "integer" },
    introductionGeneral: introductionConclusionSchema,
    parts: partSchema,
    conclusionGeneral: introductionConclusionSchema
  },
  required: [
    "id",
    "title",
    "description",
    "approach",
    "totalWords",
    "introductionGeneral",
    "parts",
    "conclusionGeneral"
  ]
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    plans: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: planSchema
    }
  },
  required: ["plans"]
};

function validatePlan(plan, expectedWords, index) {
  if (
    !plan ||
    !Array.isArray(plan.parts) ||
    plan.parts.length < 2 ||
    plan.parts.length > 3
  ) {
    throw fail(
      `Le plan ${index + 1} doit contenir 2 ou 3 parties.`,
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
        `La partie ${part.number || ""} du plan ${
          index + 1
        } ne contient aucun chapitre.`,
        502
      );
    }

    for (const chapter of part.chapters) {
      if (
        !Array.isArray(chapter.sections) ||
        chapter.sections.length < 2 ||
        chapter.sections.length > 3
      ) {
        throw fail(
          `Le chapitre ${chapter.title || ""} doit contenir 2 ou 3 sections.`,
          502
        );
      }

      if (
        !Number.isInteger(chapter.wordCount) ||
        chapter.wordCount <= 0
      ) {
        throw fail(
          `Le volume du chapitre ${chapter.title || ""} est invalide.`,
          502
        );
      }

      chapterWords += chapter.wordCount;

      for (const section of chapter.sections) {
        if (
          !Array.isArray(section.subsections) ||
          section.subsections.length < 2 ||
          section.subsections.length > 3
        ) {
          throw fail(
            `La section ${section.title || ""} doit contenir 2 ou 3 sous-sections.`,
            502
          );
        }
      }
    }
  }

  if (chapterWords !== expectedWords) {
    throw fail(
      `Le plan ${index + 1} totalise ${chapterWords} mots au lieu de ${expectedWords}.`,
      502
    );
  }

  return {
    ...plan,
    totalWords: expectedWords
  };
}

function buildContext(project, problematic) {
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

Produire des plans universitaires précis, cohérents,
variés et directement liés au sujet soumis.

INSTRUCTIONS OBLIGATOIRES :

1. Respecte le sujet exact, la problématique,
le domaine, le niveau et le contexte fournis.

2. Ne remplace jamais le sujet par un sujet plus général.

3. N'invente aucune donnée, institution,
population, période, réglementation ou référence.

4. N'ajoute pas de pays ou de contexte géographique
non mentionné dans les informations fournies.

5. L'ancrage béninois est autorisé uniquement
lorsque le sujet ou le contexte le justifie.

6. Génère exactement le nombre de plans demandé.

7. Les plans doivent être réellement différents,
y compris dans leur architecture interne.

8. Le premier plan peut privilégier une approche
théorique et conceptuelle.

9. Le deuxième plan peut privilégier une approche
analytique, explicative ou comparative.

10. Le troisième plan peut privilégier une approche
stratégique, empirique ou opérationnelle,
uniquement si le sujet le permet.

11. Ne modifie pas seulement quelques mots
pour différencier les plans.

12. Modifie les axes d'analyse, l'ordre des parties,
la fonction des chapitres et les subdivisions.

13. Chaque plan doit contenir :
- Une introduction générale.
- Deux ou trois parties.
- Des chapitres cohérents.
- Deux ou trois sections par chapitre.
- Deux ou trois sous-sections par section.
- Une conclusion générale.

14. Chaque titre doit être précis,
naturel et adapté au sujet.

15. Chaque description doit présenter
la fonction analytique du niveau concerné.

16. Chaque chapitre doit posséder
un volume de mots positif.

17. La somme des volumes des chapitres
doit correspondre exactement au volume demandé.

18. L'introduction et la conclusion générales
ne sont pas comprises dans le total des chapitres.

19. Utilise une formulation académique claire.

20. Évite les répétitions, les titres génériques,
les formulations mécaniques et les structures artificielles.

21. Respecte les instructions stylistiques :
- Phrases claires et précises.
- Vocabulaire adapté à la discipline.
- Pas de clichés liés à l'intelligence artificielle.
- Pas de données inventées.
- Pas de références fabriquées.

22. Génère uniquement la structure du plan.
Ne rédige pas le mémoire.

23. Retourne uniquement le JSON demandé.
`;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    process.env.OPENAI_MODEL || "gpt-5.6-luna";

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY est absente du serveur."
    });
  }

  try {
    const body = req.body || {};
    const project = body.project || body;

    const problematic =
      body.problematic ||
      body.problematique ||
      {};

    const count =
      Number(body.count) === 1 ? 1 : 3;

    const pages = Number(project.pages || 0);
    const sujet = String(project.sujet || "").trim();

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet est obligatoire."
      });
    }

    if (!Number.isInteger(pages) || pages <= 0) {
      return res.status(400).json({
        error: "Le nombre de pages est invalide."
      });
    }

    const expectedWords = pages * WORDS_PER_PAGE;

    const fileIds = await uploadFiles(
      project.files,
      apiKey
    );

    const fileInputs = fileIds.map((id) => ({
      type: "input_file",
      file_id: id
    }));

    const userPrompt = `
${buildContext(project, problematic)}

INSTRUCTIONS DE PRODUCTION :

Génère exactement ${count} plan(s).

La somme des volumes des chapitres
doit être exactement de ${expectedWords} mots.

Le nombre de parties doit être compris
entre 2 et 3.

Chaque chapitre doit comporter
2 ou 3 sections.

Chaque section doit comporter
2 ou 3 sous-sections.

Les plans doivent être distincts,
y compris dans leur structure interne.

Ne réutilise pas les mêmes titres,
axes d'analyse ou subdivisions entre les plans.

Ne fais pas seulement varier quelques mots.

Chaque plan doit rester cohérent avec
la problématique et le niveau d'études.

Respecte les instructions stylistiques
et l'ancrage béninois conditionnel.

Retourne uniquement le JSON demandé.
`;

    const response = await fetch(OPENAI_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },

      body: JSON.stringify({
        model,

        tools: [
          {
            type: "web_search"
          }
        ],

        text: {
          format: {
            type: "json_schema",
            name: "trimemo_plans_structure",
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
                text: buildSystemPrompt()
              }
            ]
          },

          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userPrompt
              },

              ...fileInputs
            ]
          }
        ]
      })
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
      plans
    });

  } catch (error) {
    console.error(
      "generate-plans error",
      error
    );

    return res.status(error.status || 500).json({
      error:
        error.message ||
        "Erreur interne lors de la génération des plans."
    });
  }
  }
  
