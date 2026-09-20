const STYLE_RULES = `
STYLE ACADÉMIQUE OBLIGATOIRE

1. Rigueur et dynamisme.
- Propos clairs.
- Vocabulaire précis et varié.
- Articulation logique.
- Aucun remplissage.

2. LONGUEUR DES PHRASES
- Maximum absolu : 25 mots par phrase.
- Toute phrase dépassant 30 mots est interdite.
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
- Réutiliser ensuite le sigle seul.

6. STRUCTURE
- Une idée principale par paragraphe.
- Les affirmations théoriques doivent être appuyées par une référence.
- Ajouter un exemple de terrain uniquement s'il est pertinent.
- Ne jamais inventer un terrain, une organisation, une population ou une donnée.

7. CITATIONS
- APA par défaut.
- Citation interlinéaire : (Auteur, année).
- Citation avec page : (Auteur, année, p. xx).
- Ne jamais inventer une référence.
- Si les consignes exigent des notes, utiliser [^1], [^2].
- Fournir alors la référence complète en APA.

8. ANTI-GPT
- Texte naturel et spécifique au sujet.
- Aucun contenu passe-partout.
- Aucune généralisation sans rapport avec le sujet.
- Aucun pays, ville, institution, terrain ou culture imposé.
`;

const OPENAI_URL = "https://api.openai.com/v1/responses";

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
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"'])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getStyleViolations(value) {
  const text = String(value || "").trim();
  const normalized = normalizeText(text);
  const violations = [];

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
    "parce que"
  ];

  for (const phrase of forbiddenPhrases) {
    if (normalized.includes(phrase)) {
      violations.push(`Expression interdite : "${phrase}"`);
    }
  }

  const ceciCela =
    normalized.match(/\b(ceci|cela)\b/g) || [];

  if (ceciCela.length > 1) {
    violations.push("Abondance de « ceci » ou « cela ».");
  }

  const enEffet =
    normalized.match(/\ben effet\b/g) || [];

  const dePlus =
    normalized.match(/\bde plus\b/g) || [];

  const cependant =
    normalized.match(/\bcependant\b/g) || [];

  if (enEffet.length > 1) {
    violations.push("Répétition de « en effet ».");
  }

  if (dePlus.length > 1) {
    violations.push("Répétition de « de plus ».");
  }

  if (cependant.length > 1) {
    violations.push("Répétition de « cependant ».");
  }

  for (const sentence of splitSentences(text)) {
    const words = countWords(sentence);

    if (words > 20) {
      violations.push(
        `Phrase de ${words} mots. Maximum autorisé : 20.`
      );
    }

    const adverbs =
      sentence.match(/\b[\p{L}'-]+ment\b/giu) || [];

    if (adverbs.length > 3) {
      violations.push(
        "Accumulation d'adverbes en -ment."
      );
    }
  }

  return violations;
}

function assertStyle(value, label) {
  const violations = getStyleViolations(value);

  if (violations.length) {
    throw fail(
      `${label} ne respecte pas le style imposé : ${violations.join(" | ")}`,
      502
    );
  }
}

function extractDataUrl(dataUrl) {
  const match =
    /^data:([^;]+);base64,(.+)$/s.exec(
      dataUrl || ""
    );

  if (!match) return null;

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function uploadProjectFiles(files, apiKey) {
  const uploaded = [];

  for (
    const file of Array.isArray(files)
      ? files
      : []
  ) {
    if (!file?.content) continue;

    const decoded =
      extractDataUrl(file.content);

    if (!decoded) continue;

    const form = new FormData();

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
      file.name || "document"
    );

    const response = await fetch(
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
        `Impossible de transmettre le fichier ${
          file.name || ""
        } à OpenAI. ${detail}`,
        502
      );
    }

    const data =
      await response.json();

    if (data.id) {
      uploaded.push(data.id);
    }
  }

  return uploaded;
}

function extractResponseText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  if (data?.status === "incomplete") {
    throw fail(
      `La réponse OpenAI est incomplète : ${
        data?.incomplete_details?.reason ||
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
              item?.type === "message"
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

function buildProjectContext(project) {
  return `
SUJET EXACT :
${project?.sujet || ""}

CONTEXTE FOURNI PAR L'UTILISATEUR :
${project?.contexte || ""}

CONSIGNES FOURNIES PAR L'UTILISATEUR :
${project?.consignes || ""}

NIVEAU ACADÉMIQUE :
${project?.niveau || ""}

TYPE DE DOCUMENT :
${project?.typeDoc || ""}

FORMULE :
${project?.formula || ""}

VOLUME :
${Number(project?.pages || 0)} page(s), à raison de 320 mots par page.
`;
}

const SYSTEM_PROMPT = `
Tu es le moteur de conception académique de Trimémo.

${STYLE_RULES}

RÈGLES DE FOND :

1. Pars uniquement du sujet, du contexte, des consignes,
du niveau, du type de document et des fichiers transmis.

2. N'impose jamais un pays, une ville, une institution,
un terrain, une réglementation ou une culture.

3. Ne change jamais le sens du sujet.

4. Ne transforme pas artificiellement le sujet en « impact »,
« adoption », « performance » ou « innovation ».

5. N'invente aucune donnée, population, organisation,
terrain, résultat ou référence.

6. N'utilise aucun contenu préécrit ou de secours.

7. Les problématiques doivent ouvrir des axes réellement différents.

8. Les formulations doivent rester compatibles avec le document demandé.

9. Si une information manque, ne la remplace pas par une supposition.

10. Chaque phrase doit respecter la limite de 20 mots.
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
          id: { type: "string" },
          title: { type: "string" },
          question: { type: "string" },
          rationale: { type: "string" },
          angle: { type: "string" }
        },
        required: [
          "id",
          "title",
          "question",
          "rationale",
          "angle"
        ]
      }
    }
  },
  required: ["problematiques"]
};

async function callOpenAI({
  project,
  apiKey,
  fileIds,
  count
}) {
  const requestedCount =
    count === 1 ? 1 : 3;

  const fileInputs =
    fileIds.map((fileId) => ({
      type: "input_file",
      file_id: fileId
    }));

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
                "trimemo_problematiques",
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
                  text: SYSTEM_PROMPT
                }
              ]
            },

            {
              role: "user",
              content: [
                {
                  type: "input_text",

                  text: `
${buildProjectContext(project)}

Génère exactement ${requestedCount}
problématique(s).

Chaque problématique doit contenir :

- id
- title
- question
- rationale
- angle

Les trois axes doivent être distincts.

Chaque phrase doit contenir au maximum 20 mots.

Ne force aucun exemple de terrain.

Ne crée aucune référence.

Retourne uniquement le JSON.
`
                },

                ...fileInputs
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

  if (
    !Array.isArray(
      parsed?.problematiques
    )
  ) {
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
        id:
          String(
            item?.id ||
              `problematic-${index + 1}`
          ).trim(),

        title:
          String(
            item?.title || ""
          ).trim(),

        question:
          String(
            item?.question || ""
          ).trim(),

        rationale:
          String(
            item?.rationale || ""
          ).trim(),

        angle:
          String(
            item?.angle || ""
          ).trim()
      };

      for (
        const [key, value]
        of Object.entries(result)
      ) {
        if (!value) {
          throw fail(
            `La problématique ${
              index + 1
            } est incomplète : ${key}.`,
            502
          );
        }

        assertStyle(
          value,
          `Champ ${key} de la problématique ${
            index + 1
          }`
        );
      }

      return result;
    });
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

    const fileIds =
      await uploadProjectFiles(
        project.files,
        apiKey
      );

    const output =
      await callOpenAI({
        project,
        apiKey,
        fileIds,
        count
      });

    const problematiques =
      validateProblematiques(
        output,
        count
      );

    return res.status(200).json({
      problematiques
    });
  } catch (error) {
    const status =
      Number(error?.status) || 500;

    return res.status(status).json({
      error:
        error?.message ||
        "Erreur lors de la génération des problématiques."
    });
  }
}
