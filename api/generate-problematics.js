import { getOpenAIModel } from "../lib/openai-model.js";
import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions, uploadProjectFiles, deleteOpenAIFiles } from "../lib/project-documents.js";
import { assertFilesSize } from "../lib/limits.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";

function cors(res, req) {
  const origin = String(req?.headers?.origin || "").trim().replace(/\/$/, "");
  const allowed = origin === "https://trimemo-frontend.vercel.app" || /^https:\/\/trimemo-frontend-[a-z0-9-]+\.vercel\.app$/i.test(origin) ? origin : "https://trimemo-frontend.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(value) {
  return String(value ?? "").trim();
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
        data?.incomplete_details?.reason || "raison inconnue"
      }.`,
      502
    );
  }

  const output = Array.isArray(data?.output)
    ? data.output
    : [];

  const texts = [];

  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;

    for (const content of item.content) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string"
      ) {
        texts.push(content.text);
      }

      if (
        content?.type === "refusal" &&
        content.refusal
      ) {
        throw fail(
          `OpenAI a refusé la génération : ${content.refusal}`,
          502
        );
      }
    }
  }

  const text = texts.join("\n").trim();

  if (!text) {
    throw fail(
      "La réponse OpenAI ne contient aucun texte exploitable.",
      502
    );
  }

  return text;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      return JSON.parse(
        text.slice(firstBrace, lastBrace + 1)
      );
    }

    throw fail(
      "La réponse OpenAI n'est pas un JSON valide.",
      502
    );
  }
}

function detectCitationMode(project) {
  const source = normalizeText(
    `${project?.consignes || ""} ${
      project?.contexte || ""
    }`
  ).toLowerCase();

  return /note de bas de page|notes de bas de page|footnotes?|notes bibliographiques/.test(
    source
  )
    ? "footnotes"
    : "apa";
}

function buildProjectContext(project, citationMode) {
  return `
SUJET EXACT :
${normalizeText(
  project?.sujet || project?.subject
)}

DOMAINE :
${normalizeText(
  project?.domaine || project?.domain
) || "Non précisé"}

NIVEAU ACADÉMIQUE :
${normalizeText(
  project?.niveau || project?.level
) || "Non précisé"}

TYPE DE DOCUMENT :
${normalizeText(
  project?.typeDoc ||
  project?.typeDocument ||
  project?.type
) || "Non précisé"}

FORMULE :
${normalizeText(
  project?.formule || project?.formula
) || "Non précisée"}

CONTEXTE FOURNI PAR L'UTILISATEUR :
${normalizeText(
  project?.contexte || project?.context
) || "Aucun contexte supplémentaire fourni"}

CONSIGNES FOURNIES PAR L'UTILISATEUR :
${normalizeText(
  project?.consignes || project?.instructions
) || "Aucune consigne supplémentaire fournie"}

MODE DE CITATION :
${citationMode}
`;
}

const SYSTEM_PROMPT = `${TRIMEMO_MASTER_ACADEMIC_RULES}\n
EXCEPTION SPÉCIFIQUE À LA GÉNÉRATION DES PROBLÉMATIQUES : le SUJET est la seule information obligatoire pour lancer la conception des problématiques. Ne bloque jamais la génération et ne demande jamais au client de fournir le niveau, la discipline, le contexte, les consignes, un guide méthodologique ou un plan personnel lorsqu'ils ne sont pas disponibles. Lorsqu'une information manque, construis les problématiques à partir du sujet seul et indique uniquement les limites réellement pertinentes dans la justification. Cette règle prévaut sur toute instruction générale de vérification préalable qui pourrait empêcher la génération.
Tu es le moteur de conception des problématiques académiques de Trimémo.

Ta mission consiste à formuler des problématiques précises, pertinentes,
spécifiques au sujet et exploitables pour construire un plan de recherche.

RÈGLES DE FOND :

1. Utilise uniquement les informations fournies par l'utilisateur.
2. Respecte le sens exact du sujet.
3. Ne transforme pas artificiellement le sujet en « impact »,
   « performance », « adoption » ou « innovation ».
4. N'impose aucun pays, aucune ville, aucune institution,
   aucune organisation et aucun terrain non mentionné.
5. N'invente aucune statistique, donnée, enquête ou référence.
6. N'utilise aucun contenu préécrit ou de secours.
7. Ne formule pas une question trop générale.
8. Évite les problématiques auxquelles une réponse par oui ou non suffit.
9. Chaque problématique doit permettre une analyse académique approfondie.
10. Les problématiques doivent être compatibles avec le niveau d'études
    et le type de document.
11. Les problématiques doivent être différentes les unes des autres.
12. Ne répète pas la même question avec des synonymes.

VARIATION DES PROBLÉMATIQUES :

Lorsque trois problématiques sont demandées, propose trois angles distincts
et cohérents avec le sujet.

Les angles peuvent notamment porter sur :
- les mécanismes et les déterminants ;
- les pratiques et les processus ;
- les enjeux et les limites ;
- les conditions de réussite ;
- les transformations et les perspectives ;
- les tensions théoriques ou organisationnelles.

Ces angles sont indicatifs.
Ne les applique pas automatiquement.
Choisis ceux qui correspondent réellement au sujet.

STRUCTURE DE CHAQUE PROBLÉMATIQUE :

- Un titre précis.
- Une question centrale de recherche.
- Une justification de la pertinence.
- Un angle d'analyse clairement identifié.

STYLE :

- Français académique clair, rigoureux et naturel.
- Vocabulaire précis.
- Formulations variées.
- Pas de répétitions inutiles.
- Pas de clichés rédactionnels.
- Pas de phrases artificielles.
- Les phrases doivent généralement rester à 20 mots ou moins.
- Une phrase légèrement plus longue peut être conservée si elle est nécessaire à la clarté.
- N'impose pas une citation dans chaque élément.
- N'invente aucune référence.
- Développe les sigles lors de leur première utilisation.

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
  required: [
    "problematiques",
  ],
};

async function callOpenAI({
  project,
  apiKey,
  fileIds,
  count,
}) {
  const requestedCount = Math.min(3, Math.max(1, Number(count) || 3));
  const citationMode = detectCitationMode(project);
  const documentContext = await buildProjectDocumentContext(project.files);

  const fileInputs = fileIds.map((fileId) => ({
    type: "input_file",
    file_id: fileId,
  }));

  const userPrompt = `${buildDocumentInstructions(documentContext)}\n\n${buildProjectContext(project, citationMode)}

NOMBRE DE PROBLÉMATIQUES DEMANDÉ :
${requestedCount}

Génère exactement ${requestedCount} problématique(s).

${
  requestedCount === 3
    ? `
Les trois problématiques doivent présenter des angles distincts.
Elles doivent toutes rester directement liées au sujet.
Ne produis pas trois reformulations superficielles.
`
    : `
Génère une problématique principale précise et exploitable.
`
}

Pour chaque problématique, fournis :

1. Un titre court et précis.
2. Une question centrale de recherche.
3. Une justification de sa pertinence.
4. Un angle d'analyse distinct et pertinent.

La question doit pouvoir guider la construction d'un plan académique.
Elle doit être suffisamment précise sans imposer des informations absentes.

Retourne uniquement le JSON.
`;

  const response = await fetch(
    OPENAI_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:
          getOpenAIModel(),

        text: {
          format: {
            type: "json_schema",
            name: "trimemo_problematiques",
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
              ...fileInputs,
            ],
          },
        ],
      }),
    }
  );

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw fail(
      `Réponse OpenAI invalide : ${responseText}`,
      502
    );
  }

  if (!response.ok) {
    throw fail(
      `OpenAI a refusé la génération des problématiques : ${
        data?.error?.message || responseText
      }`,
      502
    );
  }

  return extractResponseText(data);
}

function validateProblematiques(text, count) {
  const parsed = parseJson(text);

  if (!Array.isArray(parsed?.problematiques)) {
    throw fail(
      "OpenAI n'a pas retourné une liste de problématiques.",
      502
    );
  }

  const expectedCount = Math.min(3, Math.max(1, Number(count) || 3));

  if (parsed.problematiques.length < expectedCount) {
    throw fail(
      `OpenAI devait retourner ${expectedCount} problématique(s).`,
      502
    );
  }

  const results = parsed.problematiques
    .slice(0, expectedCount)
    .map((item, index) => {
      const result = {
        id: normalizeText(
          item?.id || `problematic-${index + 1}`
        ),
        title: normalizeText(item?.title),
        question: normalizeText(item?.question),
        rationale: normalizeText(item?.rationale),
        angle: normalizeText(item?.angle),
      };

      for (const [key, value] of Object.entries(result)) {
        if (!value) {
          throw fail(
            `La problématique ${
              index + 1
            } est incomplète : ${key}.`,
            502
          );
        }
      }

      return result;
    });

  return results;
}

export default async function handler(req, res) {
  cors(res, req);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée. Utilisez POST.",
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
    if (body.ownerMode === true) requireOwner(req);
    else requirePremiumOrOwner(req, body);
    const project = body.project || body;

    const count = Number(body.count) === 1
      ? 1
      : 3;

    const subject = normalizeText(
      project?.sujet || project?.subject
    );

    if (!subject) {
      return res.status(400).json({
        error: "Le sujet est obligatoire.",
      });
    }

    const supplied = String(
      project?.problematiquePersonnelle ||
      project?.problematique ||
      body.problematiquePersonnelle ||
      ""
    ).trim();

    // Une problématique fournie par le client est une instruction directe.
    // Elle ne doit jamais déclencher une nouvelle génération de problématiques.
    if (supplied) {
      return res.status(200).json({
        problematiques: [{
          id: "personal-problematic",
          title: "Problématique fournie par le client",
          question: supplied,
          rationale: "Problématique saisie par le client et conservée telle quelle.",
          angle: "Approche définie par le client",
        }],
        directToPlans: true,
      });
    }

    const files = Array.isArray(project.files) ? project.files : [];
    let fileIds = [];
    try {
      if (files.length) {
        assertFilesSize(files);
        fileIds = await uploadProjectFiles(files, apiKey);
      }
      const rawResponse = await callOpenAI({
        project: { ...project, files },
        apiKey,
        fileIds,
        count,
      });
      const generated = validateProblematiques(rawResponse, count);
      return res.status(200).json({ problematiques: generated });
    } finally {
      await deleteOpenAIFiles(fileIds, apiKey);
    }
  } catch (error) {
    const status =
      Number.isInteger(error?.status)
        ? error.status
        : 500;

    console.error(
      "Erreur generate-problematics:",
      error
    );

    return res.status(status).json({
      error:
        error?.message ||
        "Erreur lors de la génération des problématiques.",
    });
  }
}
  
