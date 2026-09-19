const STYLE_RULES = `
STYLE ACADÉMIQUE OBLIGATOIRE

1. RIGUEUR ET DYNAMISME
- Propos clairs.
- Vocabulaire précis et varié.
- Articulation logique.
- Aucun remplissage.
- Chaque phrase doit apporter une information utile.

2. LONGUEUR DES PHRASES
- Maximum absolu : 20 mots par phrase.
- Toute phrase dépassant 20 mots est interdite.
- Préférer des phrases courtes et autonomes.
- Éviter les phrases longues, les enchâssements et les structures hermétiques.

3. INTERDICTIONS FORMELLES
- Ne pas abuser des connecteurs.
- Éviter les répétitions de « en effet », « de plus » et « cependant ».
- Interdire « parce que ».
- Interdire « afin de ».
- Interdire « dans le but de ».
- Éviter l'accumulation de « ceci » et « cela ».
- Éviter les cascades de prépositions.
- Limiter les adverbes en « -ment ».
- Éviter les répétitions lexicales inutiles.
- Éviter les redondances.
- Éviter les parallélismes artificiels.
- Éviter les formulations mécaniques.
- Éviter les formulations symétriques artificielles.

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

Toute variante proche doit être reformulée.

5. SIGLES

- Définir chaque sigle à sa première occurrence.
- Format recommandé :
  « RBV (Resource-Based View) »
  « OCDE (Organisation de Coopération et de Développement Économiques) »
- Réutiliser ensuite le sigle seul.

6. STRUCTURE DE L'INTRODUCTION

L'introduction doit progresser naturellement.

Elle peut mobiliser, selon le sujet :

- une entrée contextualisée ;
- la présentation du phénomène étudié ;
- la mise en évidence d'une tension ou d'un problème ;
- la justification du sujet ;
- la problématique retenue ;
- l'annonce de l'orientation de recherche.

Ne pas appliquer mécaniquement toutes ces étapes.

La structure doit dépendre du sujet réel.

7. CITATIONS

- APA par défaut.
- Citation interlinéaire : (Auteur, année).
- Citation avec page : (Auteur, année, p. xx).
- Ne jamais inventer une référence.
- Une citation doit correspondre à une source réellement identifiée.
- Si les consignes exigent des notes de bas de page, utiliser [^1], [^2].
- Ne jamais inventer une page.
- Ne jamais inventer un DOI.
- Ne jamais attribuer une idée à un auteur sans source identifiable.

8. TERRAIN ET CONTEXTE

- Utiliser uniquement les informations fournies par l'utilisateur.
- Si aucun pays n'est indiqué, ne pas en introduire.
- Si aucun terrain n'est indiqué, ne pas en inventer.
- Si aucune organisation n'est indiquée, ne pas en inventer.
- Si aucune population n'est indiquée, ne pas en inventer.
- Si aucune période n'est indiquée, ne pas en inventer.
- Ne jamais supposer que le projet concerne le Bénin, la France, l'Afrique, l'Europe ou une autre région.

9. ANTI-GPT

- Aucun contenu générique destiné à remplir les 300 mots.
- Aucun paragraphe passe-partout.
- Aucun raisonnement préfabriqué.
- Aucun exemple inventé.
- Aucune conclusion artificielle.
- Aucun commentaire sur le fait que le texte a été généré par une IA.
`;

const OPENAI_URL = "https://api.openai.com/v1/responses";

const TARGET_WORDS = 300;
const MIN_WORDS = 250;
const MAX_WORDS = 340;

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

async function uploadProjectFiles(files, apiKey) {
  const uploaded = [];

  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.content) {
      continue;
    }

    const decoded = extractDataUrl(file.content);

    if (!decoded) {
      throw fail(
        `Le fichier ${file.name || "transmis"} possède un format de données invalide.`,
        400
      );
    }

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
        `Impossible de transmettre ${file.name || "le fichier"} à OpenAI. ${detail}`,
        502
      );
    }

    const data = await response.json();

    if (!data.id) {
      throw fail(
        `OpenAI n'a pas retourné d'identifiant pour ${file.name || "le fichier"}.`,
        502
      );
    }

    uploaded.push(data.id);
  }

  return uploaded;
}

function detectCitationMode(project) {
  const source = normalizeText(
    `${project?.consignes || ""} ${project?.contexte || ""}`
  );

  const footnotes =
    /note de bas de page|notes de bas de page|footnotes?|notes bibliographiques/.test(
      source
    );

  return footnotes ? "footnotes" : "apa";
}

function buildProjectContext(
  project,
  problematic,
  plan,
  citationMode
) {
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

NOMBRE DE PAGES DEMANDÉ :

${project?.pages || ""}

PROBLÉMATIQUE RETENUE :

${JSON.stringify(problematic || {}, null, 2)}

PLAN RETENU :

${JSON.stringify(plan || {}, null, 2)}

MODE DE CITATION :

${citationMode}
`;
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
    "parce que",
  ];

  for (const phrase of forbiddenPhrases) {
    if (normalized.includes(phrase)) {
      violations.push(
        `Expression interdite : "${phrase}"`
      );
    }
  }

  const ceciCela =
    normalized.match(/\b(ceci|cela)\b/g) || [];

  if (ceciCela.length > 1) {
    violations.push(
      "Accumulation de « ceci » ou « cela »."
    );
  }

  const enEffet =
    normalized.match(/\ben effet\b/g) || [];

  const dePlus =
    normalized.match(/\bde plus\b/g) || [];

  const cependant =
    normalized.match(/\bcependant\b/g) || [];

  if (enEffet.length > 1) {
    violations.push(
      "Répétition de « en effet »."
    );
  }

  if (dePlus.length > 1) {
    violations.push(
      "Répétition de « de plus »."
    );
  }

  if (cependant.length > 1) {
    violations.push(
      "Répétition de « cependant »."
    );
  }

  const sentences = splitSentences(text);

  for (const sentence of sentences) {
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
        "Accumulation d'adverbes en « -ment »."
      );
    }

    const prepositions =
      sentence.match(
        /\b(de|du|des|à|au|aux|pour|dans|sur|avec|sans|entre|par|en|chez|vers|sous)\b/gi
      ) || [];

    if (
      prepositions.length >= 6 &&
      words <= 20
    ) {
      violations.push(
        "Accumulation excessive de prépositions."
      );
    }
  }

  return violations;
}

function validateCitations(text) {
  const paragraphs = String(text || "")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const citationPattern =
    /\([A-ZÀ-ÖØ-Þ][^()\n]{0,100},\s*(?:19|20)\d{2}(?:,\s*p\.\s*\d+)?\)/;

  const footnotePattern =
    /\[\^\d+\]/;

  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);

    if (words < 20) {
      continue;
    }

    const hasCitation =
      citationPattern.test(paragraph) ||
      footnotePattern.test(paragraph);

    if (!hasCitation) {
      throw fail(
        "L'introduction contient un paragraphe substantiel sans citation.",
        502
      );
    }
  }
}

function assertIntroductionStyle(text) {
  const violations = getStyleViolations(text);

  if (violations.length > 0) {
    throw fail(
      `L'introduction ne respecte pas le style imposé : ${violations.join(
        " | "
      )}`,
      502
    );
  }

  const wordCount = countWords(text);

  if (wordCount < MIN_WORDS) {
    throw fail(
      `L'introduction contient seulement ${wordCount} mots. Minimum attendu : ${MIN_WORDS}.`,
      502
    );
  }

  if (wordCount > MAX_WORDS) {
    throw fail(
      `L'introduction contient ${wordCount} mots. Maximum autorisé pour l'aperçu : ${MAX_WORDS}.`,
      502
    );
  }
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
      `OpenAI a refusé la génération : ${refusal.refusal}`,
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

const SYSTEM_PROMPT = `
Tu es le moteur de rédaction académique de Trimémo.

${STYLE_RULES}

MISSION :

Rédiger uniquement une introduction académique correspondant
exactement au sujet, au contexte et aux consignes fournis.

L'introduction doit être spécifique au projet.

Elle ne doit pas être une introduction générique.

Elle doit établir progressivement le problème étudié.

Elle doit utiliser la problématique et le plan fournis
sans simplement les recopier.

IMPORTANT :

Le résultat est un aperçu gratuit.

Il doit rester volontairement incomplet.

Ne rédige pas une introduction complète.

Ne termine pas artificiellement la démonstration.

Ne rédige pas une conclusion.

Ne développe pas toutes les dimensions du sujet.

Ne révèle pas tout le contenu qui sera développé dans la rédaction complète.

Le texte doit toutefois être suffisamment développé
pour permettre à l'utilisateur d'évaluer la qualité académique.

Le texte doit comporter environ 300 mots.

Respecte strictement la limite de 20 mots par phrase.

Ne produis aucun commentaire avant ou après l'introduction.

Retourne uniquement le JSON demandé.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    introduction: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string",
        },
        content: {
          type: "string",
        },
        wordCount: {
          type: "integer",
        },
        incomplete: {
          type: "boolean",
        },
      },
      required: [
        "title",
        "content",
        "wordCount",
        "incomplete",
      ],
    },
  },
  required: ["introduction"],
};

async function generateIntroduction(
  project,
  problematic,
  plan,
  apiKey,
  fileIds
) {
  const citationMode =
    detectCitationMode(project);

  const files = fileIds.map((id) => ({
    type: "input_file",
    file_id: id,
  }));

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
            name: "trimemo_introduction_preview",
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
  problematic,
  plan,
  citationMode
)}

Rédige une introduction académique d'environ ${TARGET_WORDS} mots.

Fourchette obligatoire :
${MIN_WORDS} à ${MAX_WORDS} mots.

L'introduction doit :

1. partir du sujet exact ;
2. utiliser uniquement le contexte fourni ;
3. exploiter la problématique retenue ;
4. tenir compte du plan retenu ;
5. mobiliser des sources pertinentes lorsque nécessaire ;
6. utiliser le mode de citation ${citationMode} ;
7. respecter la limite de 20 mots par phrase ;
8. rester volontairement incomplète ;
9. ne pas produire de conclusion ;
10. ne pas inventer de terrain ;
11. ne pas inventer de données ;
12. ne pas inventer de références ;
13. ne pas imposer de pays ou de contexte géographique absent.

Si les documents transmis contiennent des informations pertinentes,
utilise-les comme priorité.

Si une information n'est pas disponible,
ne la remplace pas par une supposition.

La propriété "incomplete" doit obligatoirement être true.

Retourne uniquement :

{
  "introduction": {
    "title": "...",
    "content": "...",
    "wordCount": 300,
    "incomplete": true
  }
}
`,
              },

              ...files,
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw fail(
      `OpenAI a refusé la génération de l'introduction. ${detail}`,
      502
    );
  }

  return extractResponseText(
    await response.json()
  );
}

function validateIntroduction(text) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail(
      "La réponse OpenAI n'a pas le format JSON attendu.",
      502
    );
  }

  const introduction =
    parsed?.introduction;

  if (
    !introduction ||
    typeof introduction !== "object"
  ) {
    throw fail(
      "OpenAI n'a pas retourné d'introduction.",
      502
    );
  }

  if (
    !String(introduction.title || "").trim()
  ) {
    throw fail(
      "Le titre de l'introduction est absent.",
      502
    );
  }

  const content =
    String(introduction.content || "").trim();

  if (!content) {
    throw fail(
      "Le contenu de l'introduction est vide.",
      502
    );
  }

  if (introduction.incomplete !== true) {
    throw fail(
      "L'aperçu doit être marqué comme incomplet.",
      502
    );
  }

  assertIntroductionStyle(content);

  validateCitations(content);

  return {
    title: String(
      introduction.title
    ).trim(),

    content,

    wordCount: countWords(content),

    incomplete: true,
  };
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
      error: "Méthode non autorisée.",
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

    const problematic =
      body.problematic ||
      body.problematique;

    const plan =
      body.plan || null;

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

    if (!problematic) {
      return res.status(400).json({
        error:
          "La problématique est obligatoire.",
      });
    }

    if (!plan) {
      return res.status(400).json({
        error:
          "Le plan est obligatoire.",
      });
    }

    const fileIds =
      await uploadProjectFiles(
        project.files,
        apiKey
      );

    const raw =
      await generateIntroduction(
        project,
        problematic,
        plan,
        apiKey,
        fileIds
      );

    const introduction =
      validateIntroduction(raw);

    return res.status(200).json({
      introduction,
    });
  } catch (error) {
    const status =
      Number(error?.status) || 500;

    return res.status(status).json({
      error:
        error?.message ||
        "Erreur lors de la génération de l'aperçu.",
    });
  }
        }
