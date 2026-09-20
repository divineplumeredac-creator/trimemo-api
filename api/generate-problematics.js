const STYLE_RULES = `
STYLE ACADÉMIQUE OBLIGATOIRE

1. Rigueur et dynamisme.
- Propos clairs.
- Vocabulaire précis et varié.
- Articulation logique.
- Aucun remplissage.

2. LONGUEUR DES PHRASES
- Référence recommandée: 28 mots maximum par phrase.
- Une légère variation ne doit jamais bloquer la génération.
- Préférer des phrases courtes et autonomes.
- Éviter les enchâssements et les formulations hermétiques.

3. INTERDICTIONS FORMELLES
- Pas de connecteurs abusifs.
- Éviter les répétitions de « en effet », « de plus » et « cependant ».
- Éviter « parce que », « afin de » et « dans le but de ».
- Éviter l'accumulation de « ceci » et « cela ».
- Éviter les prépositions en cascade.
- Limiter les adverbes en -ment.
- Éviter les clichés et formulations automatisées.
- Éviter les constructions symétriques artificielles.
- Éviter les répétitions, redondances et parallélismes.
- Ne pas produire de plan tiroir.
- Ne pas produire une structure mécanique ou prévisible.

4. EXPRESSIONS À ÉVITER
Ne pas employer inutilement:
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

5. SIGLES
- Définir chaque sigle à sa première occurrence.
- Exemple:
  « RBV (Resource-Based View) »
  « OCDE (Organisation de Coopération et de Développement Économiques) »

6. STRUCTURE
- Un paragraphe porte une idée principale.
- Les affirmations théoriques ou factuelles doivent idéalement être appuyées par une référence.
- Ajouter un exemple de terrain seulement s'il est réellement soutenu.
- Ne jamais inventer un terrain, une organisation, une population ou une donnée.

7. CITATIONS
- APA par défaut.
- Citation interlinéaire: (Auteur, année).
- Citation avec page: (Auteur, année, p. xx).
- Ne jamais inventer une référence.
- Si les consignes exigent des notes de bas de page, utiliser [^1], [^2].

8. ANTI-GPT
- Texte naturel et spécifique au sujet.
- Aucun contenu passe-partout.
- Aucun pays, ville, institution, terrain ou culture absent des données utilisateur.
`;

const OPENAI_URL = "https://api.openai.com/v1/responses";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function extractDataUrl(dataUrl) {
  const match =
    /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");

  if (!match) return null;

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function uploadProjectFiles(files, apiKey) {
  const uploaded = [];

  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.content) continue;

    const decoded = extractDataUrl(file.content);

    if (!decoded) continue;

    const form = new FormData();

    form.append("purpose", "user_data");

    form.append(
      "file",
      new Blob([decoded.buffer], {
        type:
          decoded.mime ||
          file.type ||
          "application/octet-stream",
      }),
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
      const detail = await response.text();

      throw fail(
        `Impossible de transmettre le fichier ${
          file.name || ""
        } à OpenAI. ${detail}`,
        502
      );
    }

    const data = await response.json();

    if (data.id) {
      uploaded.push(data.id);
    }
  }

  return uploaded;
}

function buildProjectContext(project, citationMode) {
  return `
SUJET EXACT:
${project?.sujet || ""}

CONTEXTE FOURNI PAR L'UTILISATEUR:
${project?.contexte || ""}

CONSIGNES FOURNIES PAR L'UTILISATEUR:
${project?.consignes || ""}

NIVEAU ACADÉMIQUE:
${project?.niveau || ""}

TYPE DE DOCUMENT:
${project?.typeDoc || ""}

FORMULE:
${project?.formula || ""}

MODE DE CITATION:
${citationMode}

VOLUME:
${Number(project?.pages || 0)} page(s), à raison de 320 mots par page.
`;
}

const SYSTEM_PROMPT = `
Tu es le moteur de conception académique de Trimémo.

${STYLE_RULES}

RÈGLES DE FOND:

1. Pars uniquement des informations réellement transmises.
2. N'impose jamais un pays, une ville, une institution ou un terrain.
3. Ne change jamais le sens du sujet.
4. Ne transforme pas artificiellement le sujet en « impact », « adoption », « performance » ou « innovation ».
5. N'invente aucune donnée.
6. N'invente aucune population.
7. N'invente aucune organisation.
8. N'invente aucun résultat.
9. N'invente aucune référence.
10. N'utilise aucun contenu de secours.
11. Les problématiques doivent ouvrir des axes réellement différents.
12. Les formulations doivent être précises et exploitables.

Retourne uniquement le JSON demandé.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    problematiques: {
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
          question: {
            type: "string",
          },
          rationale: {
            type: "string",
          },
          angle: {
            type: "string",
          },
        },
        required: [
          "id",
          "title",
          "question",
          "rationale",
          "angle",
        ],
      },
    },
  },
  required: ["problematiques"],
};

function extractResponseText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  if (data?.status === "incomplete") {
    throw fail(
      `La réponse OpenAI est incomplète: ${
        data?.incomplete_details?.reason ||
        "raison inconnue"
      }.`,
      502
    );
  }

  const refusal = Array.isArray(data?.output)
    ? data.output
        .filter(
          (item) => item?.type === "message"
        )
        .flatMap((item) =>
          Array.isArray(item.content)
            ? item.content
            : []
        )
        .find(
          (part) =>
            part?.type === "refusal"
        )
    : null;

  if (refusal?.refusal) {
    throw fail(
      `OpenAI a refusé la génération: ${refusal.refusal}`,
      502
    );
  }

  const parts = Array.isArray(data?.output)
    ? data.output
        .filter(
          (item) => item?.type === "message"
        )
        .flatMap((item) =>
          Array.isArray(item.content)
            ? item.content
            : []
        )
        .filter(
          (part) =>
            part?.type === "output_text" &&
            typeof part.text === "string"
        )
        .map((part) => part.text)
    : [];

  const text = parts.join("").trim();

  if (!text) {
    throw fail(
      "La réponse OpenAI ne contient aucun texte exploitable.",
      502
    );
  }

  return text;
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
    .replace(/\[\^[^\]]+\]/g, " ")
    .split(
      /(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"'])/
    )
    .map((item) => item.trim())
    .filter(Boolean);
}

function getStyleWarnings(value) {
  const text = String(value || "").trim();
  const normalized = normalizeText(text);
  const warnings = [];

  const forbiddenPhrases = [
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
    "parce que",
  ];

  for (const phrase of forbiddenPhrases) {
    if (normalized.includes(phrase)) {
      warnings.push(
        `Expression à reformuler: "${phrase}"`
      );
    }
  }

  for (const sentence of splitSentences(text)) {
    const words = countWords(sentence);

    if (words > 28) {
      warnings.push(
        `Phrase de ${words} mots; référence recommandée: 28.`
      );
    }
  }

  return warnings;
}

function assertStyle(value, label) {
  const warnings = getStyleWarnings(value);

  if (warnings.length) {
    console.warn(
      `[Contrôle de style non bloquant] ${label}: ${warnings.join(
        " | "
      )}`
    );
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

function detectCitationMode(project) {
  const source = normalizeText(
    `${project?.consignes || ""} ${
      project?.contexte || ""
    }`
  );

  return /(
    note de bas de page|
    notes de bas de page|
    footnotes?|
    notes bibliographiques
  )/.test(source)
    ? "footnotes"
    : "apa";
}

async function callOpenAI({
  project,
  apiKey,
  fileIds,
  count,
}) {
  const requestedCount =
    count === 1 ? 1 : 3;

  const fileInputs = fileIds.map(
    (fileId) => ({
      type: "input_file",
      file_id: fileId,
    })
  );

  const citationMode =
    detectCitationMode(project);

  const response = await fetch(
    OPENAI_URL,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        Authorization:
          `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:
          process.env.OPENAI_MODEL ||
          "gpt-5.6-luna",

        tools: [
          {
            type: "web_search",
          },
        ],

        text: {
          format: {
            type: "json_schema",
            name:
              "trimemo_problematiques",
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
                text: `
${buildProjectContext(
  project,
  citationMode
)}

Génère exactement ${requestedCount} problématique(s).

Chaque problématique doit contenir:
- un titre précis;
- une question de recherche;
- une justification de sa pertinence;
- un angle distinct.

Privilégie des phrases de 28 mots maximum.
Une légère variation ne doit jamais bloquer la génération.

Ne force aucun exemple de terrain.
Ne cite aucune référence inventée.

Retourne uniquement le JSON.
`,
              },

              ...fileInputs,
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw fail(
      `OpenAI a refusé la génération des problématiques. ${detail}`,
      502
    );
  }

  return extractResponseText(
    await response.json()
  );
}

function validateProblematiques(
  text,
  count
) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail(
      "La réponse OpenAI n'a pas le format JSON attendu.",
      502
    );
  }

  if (!Array.isArray(parsed?.problematiques)) {
    throw fail(
      "OpenAI n'a pas retourné de liste de problématiques.",
      502
    );
  }

  const expectedCount =
    count === 1 ? 1 : 3;

  if (
    parsed.problematiques.length <
    expectedCount
  ) {
    throw fail(
      `OpenAI devait retourner ${expectedCount} problématique(s).`,
      502
    );
  }

  return parsed.problematiques
    .slice(0, expectedCount)
    .map((item, index) => {
      const result = {
        id: String(
          item?.id ||
            `problematic-${index + 1}`
        ).trim(),

        title: String(
          item?.title || ""
        ).trim(),

        question: String(
          item?.question || ""
        ).trim(),

        rationale: String(
          item?.rationale || ""
        ).trim(),

        angle: String(
          item?.angle || ""
        ).trim(),
      };

      for (const [
        key,
        value,
      ] of Object.entries(result)) {
        if (!value) {
          throw fail(
            `La problématique ${
              index + 1
            } est incomplète: ${key}.`,
            502
          );
        }
      }

      assertStyle(
        result.title,
        `Titre de la problématique ${
          index + 1
        }`
      );

      assertStyle(
        result.question,
        `Question de la problématique ${
          index + 1
        }`
      );

      assertStyle(
        result.rationale,
        `Justification de la problématique ${
          index + 1
        }`
      );

      assertStyle(
        result.angle,
        `Angle de la problématique ${
          index + 1
        }`
      );

      return result;
    });
}

export default async function handler(
  req,
  res
) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Méthode non autorisée.",
    });
  }

  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY est absente du serveur.",
    });
  }

  try {
    const body = req.body || {};

    const project =
      body.project || body;

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
          "Le sujet est obligatoire.",
      });
    }

    const fileIds =
      await uploadProjectFiles(
        project.files,
        apiKey
      );

    const data =
      await callOpenAI({
        project,
        apiKey,
        fileIds,
        count,
      });

    const problematiques =
      validateProblematiques(
        data,
        count
      );

    return res.status(200).json({
      problematiques,
    });
  } catch (error) {
    const status =
      Number(error?.status) || 500;

    return res.status(status).json({
      error:
        error?.message ||
        "Erreur lors de la génération des problématiques.",
    });
  }
         }
