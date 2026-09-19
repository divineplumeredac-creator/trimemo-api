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
- Réutiliser ensuite le sigle seul.

6. STRUCTURE DES PARAGRAPHES
- Une idée principale par paragraphe.
- Une référence pertinente pour les affirmations théoriques.
- Un exemple de terrain seulement s'il est pertinent.
- L'exemple doit être fondé sur les données disponibles.
- Ne jamais inventer un terrain, une organisation ou une population.

7. CITATIONS
- APA par défaut.
- Citation : (Auteur, année).
- Citation avec page : (Auteur, année, p. xx).
- Notes de bas de page si les consignes l'exigent : [^1], [^2].
- Référence complète en APA dans les notes.
- Ne jamais inventer une référence.

8. ANTI-GPT
- Texte naturel et spécifique.
- Aucun remplissage.
- Aucune formulation passe-partout.
- Aucun pays, terrain, institution ou contexte imposé.
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
    .replace(
      /\[\^[^\]]+\]/g,
      " "
    )
    .split(
      /(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"'])/
    )
    .map(
      (item) =>
        item.trim()
    )
    .filter(Boolean);
}

function getStyleViolations(
  value,
  requireCitations = false
) {
  const text =
    String(value || "").trim();

  const normalized =
    normalizeText(text);

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

  for (
    const phrase of
    forbiddenPhrases
  ) {
    if (
      normalized.includes(
        phrase
      )
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

  if (
    ceciCela.length > 1
  ) {
    violations.push(
      "Abondance de « ceci » ou « cela »."
    );
  }

  const enEffet =
    normalized.match(
      /\ben effet\b/g
    ) || [];

  const dePlus =
    normalized.match(
      /\bde plus\b/g
    ) || [];

  const cependant =
    normalized.match(
      /\bcependant\b/g
    ) || [];

  if (
    enEffet.length > 1
  ) {
    violations.push(
      "Répétition de « en effet »."
    );
  }

  if (
    dePlus.length > 1
  ) {
    violations.push(
      "Répétition de « de plus »."
    );
  }

  if (
    cependant.length > 1
  ) {
    violations.push(
      "Répétition de « cependant »."
    );
  }

  const sentences =
    splitSentences(text);

  for (
    const sentence of
    sentences
  ) {
    const words =
      countWords(
        sentence
      );

    if (words > 20) {
      violations.push(
        `Phrase de ${words} mots. Maximum : 20.`
      );
    }

    const adverbs =
      sentence.match(
        /\b[\p{L}'-]+ment\b/giu
      ) || [];

    if (
      adverbs.length > 3
    ) {
      violations.push(
        "Accumulation d'adverbes en -ment."
      );
    }

    const prepositions =
      sentence.match(
        /\b(de|du|des|à|au|aux|pour|dans|sur|avec|sans|entre|par|en|chez|vers|sous)\b/gi
      ) || [];

    if (
      prepositions.length >= 6
    ) {
      violations.push(
        "Accumulation excessive de prépositions."
      );
    }
  }

  if (
    requireCitations &&
    text.length > 0
  ) {
    const paragraphs =
      text
        .split(/\n\s*\n+/)
        .map(
          (p) => p.trim()
        )
        .filter(Boolean);

    const citationPattern =
      /\([A-ZÀ-ÖØ-Þ][^()\n]{0,100},\s*(?:19|20)\d{2}(?:,\s*p\.\s*\d+)?\)/;

    const footnotePattern =
      /\[\^\d+\]/;

    for (
      const paragraph of
      paragraphs
    ) {
      const substantive =
        countWords(
          paragraph
        ) >= 12;

      if (
        substantive &&
        !citationPattern.test(
          paragraph
        ) &&
        !footnotePattern.test(
          paragraph
        )
      ) {
        violations.push(
          "Paragraphe substantiel sans citation APA ou note de bas de page."
        );
      }
    }
  }

  return violations;
}

function assertStyle(
  value,
  label,
  requireCitations = false
) {
  const violations =
    getStyleViolations(
      value,
      requireCitations
    );

  if (
    violations.length
  ) {
    throw fail(
      `${label} ne respecte pas le style : ${violations.join(" | ")}`,
      502
    );
  }
}

function detectCitationMode(
  project
) {
  const source =
    normalizeText(
      `${project?.consignes || ""} ${project?.contexte || ""}`
    );

  return /(
    note de bas de page|
    notes de bas de page|
    footnotes?|
    notes bibliographiques
  )/x.test(
    source.replace(/\s+/g, "")
  )
    ? "footnotes"
    : "apa";
}

function extractDataUrl(
  dataUrl
) {
  const match =
    /^data:([^;]+);base64,(.+)$/s.exec(
      dataUrl || ""
    );

  if (!match)
    return null;

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
          .flatMap(
            (item) =>
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

function buildProjectContext(
  project,
  problematic,
  plan,
  block,
  preceding,
  citationMode
) {
  const pages =
    Number(
      project?.pages || 0
    );

  return `
SUJET EXACT :
${project?.sujet || ""}

CONTEXTE FOURNI PAR L'UTILISATEUR :
${project?.contexte || ""}

CONSIGNES FOURNIES PAR L'UTILISATEUR :
${project?.consignes || ""}

NIVEAU :
${project?.niveau || ""}

TYPE DE DOCUMENT :
${project?.typeDoc || ""}

FORMULE :
${project?.formula || ""}

VOLUME :
${pages} page(s)

RÈGLE :
1 page = ${WORDS_PER_PAGE} mots

MODE DE CITATION :
${citationMode}

PROBLÉMATIQUE :
${JSON.stringify(
  problematic || {},
  null,
  2
)}

PLAN :
${JSON.stringify(
  plan || {},
  null,
  2
)}

BLOC À RÉDIGER :
${JSON.stringify(
  block || {},
  null,
  2
)}

BLOCS PRÉCÉDENTS :
${JSON.stringify(
  Array.isArray(
    preceding
  )
    ? preceding
    : [],
  null,
  2
)}
`;
}

const SYSTEM_PROMPT = `
Tu es le moteur de rédaction académique de Trimémo.

${STYLE_RULES}

RÈGLES DE RÉDACTION :

1. Rédige exclusivement le bloc demandé.
2. Chaque phrase contient au maximum 20 mots.
3. Chaque paragraphe porte une idée principale.
4. Appuie les affirmations théoriques par une référence pertinente.
5. Utilise APA par défaut.
6. Utilise [^1], [^2] si les consignes exigent des notes.
7. Définis chaque sigle à sa première occurrence.
8. Ajoute un exemple de terrain uniquement s'il est pertinent.
9. L'exemple doit provenir des données disponibles.
10. N'invente aucune donnée.
11. N'invente aucun résultat.
12. N'invente aucune référence.
13. N'impose aucun pays, ville, institution ou terrain.
14. Ne produis aucun paragraphe générique.
15. Ne répète pas les blocs précédents.
16. Assure une continuité logique avec les blocs précédents.
17. Respecte la fonction du bloc dans le plan.
18. Évite les structures symétriques.
19. N'utilise aucun fallback.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,

  properties: {
    id: {
      type: "string"
    },

    title: {
      type: "string"
    },

    content: {
      type: "string"
    },

    wordCount: {
      type: "integer"
    },

    sources: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          title: {
            type: "string"
          },

          author: {
            type: [
              "string",
              "null"
            ]
          },

          year: {
            type: [
              "string",
              "null"
            ]
          },

          url: {
            type: [
              "string",
              "null"
            ]
          }
        },

        required: [
          "title",
          "author",
          "year",
          "url"
        ]
      }
    }
  },

  required: [
    "id",
    "title",
    "content",
    "wordCount",
    "sources"
  ]
};

async function generateBlock(
  project,
  problematic,
  plan,
  block,
  preceding,
  apiKey,
  fileIds
) {
  const expectedWords =
    Number(
      block?.expectedWords || 0
    );

  if (
    !Number.isInteger(
      expectedWords
    ) ||
    expectedWords <= 0
  ) {
    throw fail(
      "Le nombre de mots demandé pour le bloc est invalide."
    );
  }

  const citationMode =
    detectCitationMode(
      project
    );

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
                "trimemo_block",
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
${buildProjectContext(
  project,
  problematic,
  plan,
  block,
  preceding,
  citationMode
)}

Rédige uniquement le bloc demandé.

CIBLE :
${expectedWords} mots environ.

Exigences :

- maximum 20 mots par phrase ;
- une idée principale par paragraphe ;
- une référence pertinente pour les affirmations théoriques ;
- APA par défaut ;
- notes [^1] si exigées ;
- définition des sigles ;
- exemple de terrain uniquement s'il est pertinent ;
- aucun cliché IA ;
- aucune donnée inventée ;
- aucune référence inventée.

Le champ wordCount doit correspondre
au nombre réel de mots du contenu.

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
      `OpenAI a refusé la rédaction du bloc. ${detail}`,
      502
    );
  }

  return extractResponseText(
    await response.json()
  );
}

function validateBlock(
  text,
  block,
  project
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

  const content =
    String(
      parsed?.content || ""
    ).trim();

  if (!content) {
    throw fail(
      "OpenAI n'a produit aucun contenu.",
      502
    );
  }

  const actualWords =
    countWords(content);

  const expectedWords =
    Number(
      block?.expectedWords
    );

  const tolerance =
    Math.max(
      30,
      Math.round(
        expectedWords * 0.08
      )
    );

  if (
    Math.abs(
      actualWords -
        expectedWords
    ) > tolerance
  ) {
    throw fail(
      `Le bloc contient ${actualWords} mots alors que la cible est ${expectedWords} mots.`,
      502
    );
  }

  assertStyle(
    content,
    "Contenu du bloc",
    true
  );

  const sources =
    Array.isArray(
      parsed?.sources
    )
      ? parsed.sources
          .map(
            (source) => ({
              title:
                String(
                  source?.title ||
                    ""
                ).trim(),

              author:
                source?.author
                  ? String(
                      source.author
                    ).trim()
                  : null,

              year:
                source?.year
                  ? String(
                      source.year
                    ).trim()
                  : null,

              url:
                source?.url
                  ? String(
                      source.url
                    ).trim()
                  : null
            })
          )
          .filter(
            (source) =>
              source.title
          )
      : [];

  if (
    sources.length === 0
  ) {
    throw fail(
      "Aucune source n'a été fournie pour le bloc.",
      502
    );
  }

  return {
    id:
      String(
        parsed?.id ||
          block?.id ||
          ""
      ),

    title:
      String(
        parsed?.title ||
          block?.title ||
          ""
      ).trim(),

    content,

    wordCount:
      actualWords,

    sources
  };
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
      body.project || {};

    const problematic =
      body.problematic ||
      body.problematique;

    const plan =
      body.plan;

    const block =
      body.block;

    const preceding =
      Array.isArray(
        body.preceding
      )
        ? body.preceding
        : [];

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

    if (!plan) {
      return res.status(400).json({
        error:
          "Le plan est obligatoire."
      });
    }

    if (
      !block?.title ||
      !block?.expectedWords
    ) {
      return res.status(400).json({
        error:
          "Le bloc à rédiger est invalide."
      });
    }

    const fileIds =
      await uploadFiles(
        project.files,
        apiKey
      );

    const output =
      await generateBlock(
        project,
        problematic,
        plan,
        block,
        preceding,
        apiKey,
        fileIds
      );

    const result =
      validateBlock(
        output,
        block,
        project
      );

    return res.status(200).json(
      result
    );
  } catch (error) {
    const status =
      Number(error?.status) || 500;

    return res.status(status).json({
      error:
        error?.message ||
        "Erreur lors de la rédaction du bloc."
    });
  }
}
