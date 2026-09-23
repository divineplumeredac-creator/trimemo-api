const OPENAI_URL = "https://api.openai.com/v1/responses";
const MAX_BLOCK_WORDS = 900;

const STYLE_RULES = `
INSTRUCTIONS STYLISTIQUES OBLIGATOIRES

1. Rigueur académique, vocabulaire précis et progression logique.
2. Maximum de 20 mots par phrase. Si une phrase dépasse cette limite, la diviser.
3. Un paragraphe développe une idée principale.
4. Éviter les répétitions, les formulations mécaniques et les clichés associés à l'IA.
5. Éviter l'abus de « en effet », « de plus » et « cependant ».
6. Éviter « ceci », « cela », les adverbes inutiles en « -ment » et les prépositions en cascade.
7. Ne pas utiliser de tiret long dans le corps du texte.
8. Définir chaque sigle à sa première apparition.
9. L'ancrage béninois est autorisé uniquement si le sujet ou le contexte le justifie.
10. Ne jamais inventer une donnée, une institution, une enquête, un auteur, une date, une page, un DOI ou une référence.
11. Une source doit être réellement utilisée et identifiable par une URL ou un DOI.
12. Une affirmation théorique ou factuelle importante doit être accompagnée d'une citation APA ou d'une note de bas de page.
`;

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

function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitSentences(value) {
  return String(value || "")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"'])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function validateSentenceLength(content) {
  const violations = [];

  for (const sentence of splitSentences(content)) {
    const words = countWords(sentence);

    if (words > 20) {
      violations.push(`Une phrase contient ${words} mots.`);
    }
  }

  return violations;
}

function detectCitationMode(project) {
  const text = normalize(
    `${project?.consignes || ""} ${project?.contexte || ""}`
  );

  return /(note de bas de page|notes de bas de page|footnotes?|notes bibliographiques)/.test(text)
    ? "footnotes"
    : "apa";
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
    const decoded = extractDataUrl(file?.content);

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
      throw fail(
        `Impossible de transmettre ${file.name || "le fichier"} à OpenAI. ${await response.text()}`,
        502
      );
    }

    const data = await response.json();

    if (data.id) ids.push(data.id);
  }

  return ids;
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (data?.status === "incomplete") {
    throw fail(
      `La réponse OpenAI est incomplète : ${data?.incomplete_details?.reason || "raison inconnue"}.`,
      502
    );
  }

  const refusal = Array.isArray(data?.output)
    ? data.output
        .filter((item) => item?.type === "message")
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .find((part) => part?.type === "refusal")
    : null;

  if (refusal?.refusal) {
    throw fail(`OpenAI a refusé la rédaction : ${refusal.refusal}`, 502);
  }

  const text = Array.isArray(data?.output)
    ? data.output
        .filter((item) => item?.type === "message")
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .filter((part) => part?.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
        .trim()
    : "";

  if (!text) {
    throw fail("La réponse OpenAI ne contient aucun texte exploitable.", 502);
  }

  return text;
}

function buildContext({ project, problematic, plan, block, preceding, citationMode }) {
  return `
SUJET :
${project?.sujet || ""}

DOMAINE :
${project?.domaine || ""}

NIVEAU :
${project?.niveau || ""}

TYPE DE DOCUMENT :
${project?.typeDoc || project?.typeDocument || ""}

CONTEXTE :
${project?.contexte || project?.context || ""}

CONSIGNES :
${project?.consignes || project?.instructions || ""}

MODE DE CITATION :
${citationMode}

PROBLÉMATIQUE :
${JSON.stringify(problematic || {}, null, 2)}

PLAN COMPLET :
${JSON.stringify(plan || {}, null, 2)}

BLOC À RÉDIGER :
${JSON.stringify(block || {}, null, 2)}

BLOCS PRÉCÉDENTS :
${JSON.stringify(Array.isArray(preceding) ? preceding : [], null, 2)}
`;
}

const SOURCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    author: { type: "string" },
    year: { type: "string" },
    title: { type: "string" },
    publisher: { type: "string" },
    url: { type: "string" },
    doi: { type: "string" },
    citation: { type: "string" },
  },
  required: [
    "id",
    "author",
    "year",
    "title",
    "publisher",
    "url",
    "doi",
    "citation",
  ],
};

const FOOTNOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    number: { type: "integer" },
    marker: { type: "string" },
    text: { type: "string" },
    sourceId: { type: "string" },
  },
  required: ["number", "marker", "text", "sourceId"],
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    content: { type: "string" },
    wordCount: { type: "integer" },
    sources: {
      type: "array",
      items: SOURCE_SCHEMA,
    },
    footnotes: {
      type: "array",
      items: FOOTNOTE_SCHEMA,
    },
  },
  required: ["id", "title", "content", "wordCount", "sources", "footnotes"],
};

function normalizeSource(source) {
  return {
    id: String(source?.id || "").trim(),
    author: String(source?.author || "").trim(),
    year: String(source?.year || "").trim(),
    title: String(source?.title || "").trim(),
    publisher: String(source?.publisher || "").trim(),
    url: String(source?.url || "").trim(),
    doi: String(source?.doi || "").trim(),
    citation: String(source?.citation || "").trim(),
  };
}

function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw fail("Aucune source n'a été retournée pour ce bloc.", 502);
  }

  const normalized = sources.map(normalizeSource);
  const ids = new Set();

  for (const source of normalized) {
    if (!source.id || ids.has(source.id)) {
      throw fail("Les identifiants des sources sont invalides ou dupliqués.", 502);
    }

    if (!source.title || !source.author || !source.year || !source.citation) {
      throw fail(
        `La source ${source.id || "inconnue"} possède des informations bibliographiques incomplètes.`,
        502
      );
    }

    if (!source.url && !source.doi) {
      throw fail(
        `La source ${source.id} ne possède ni URL ni DOI vérifiable.`,
        502
      );
    }

    if (source.url && !/^https?:\/\//i.test(source.url)) {
      throw fail(`L'URL de la source ${source.id} est invalide.`, 502);
    }

    if (source.doi && !/^10\.\d{4,9}\//i.test(source.doi.replace(/^https?:\/\/doi\.org\//i, ""))) {
      throw fail(`Le DOI de la source ${source.id} est invalide.`, 502);
    }

    ids.add(source.id);
  }

  return { normalized, ids };
}

function validateFootnotes(footnotes, sourceIds, citationMode) {
  if (!Array.isArray(footnotes)) {
    throw fail("Les notes de bas de page ont un format invalide.", 502);
  }

  for (const note of footnotes) {
    if (!note || !note.text || !note.marker || !note.sourceId) {
      throw fail("Une note de bas de page est incomplète.", 502);
    }

    if (!sourceIds.has(note.sourceId)) {
      throw fail(
        `La note ${note.number || ""} cite une source absente de la bibliographie.`,
        502
      );
    }
  }

  if (citationMode === "footnotes" && footnotes.length === 0) {
    throw fail(
      "Les consignes demandent des notes de bas de page, mais aucune note n'a été produite.",
      502
    );
  }
}

function validateContentCitations(content, sources, footnotes, citationMode) {
  const normalizedContent = String(content || "");
  const sourceIds = sources.map((source) => source.id);

  const hasApaCitation = /\([^()\n]{2,100},\s*(?:19|20)\d{2}(?:,\s*p\.\s*\d+)?\)/.test(normalizedContent);
  const hasFootnoteMarker = /\[\^\d+\]/.test(normalizedContent);
  const hasSourceMarker = sourceIds.some((id) => normalizedContent.includes(`[${id}]`));

  if (citationMode === "footnotes" && !hasFootnoteMarker) {
    throw fail("Le contenu ne contient aucun marqueur de note de bas de page.", 502);
  }

  if (citationMode === "apa" && !hasApaCitation && !hasSourceMarker && !hasFootnoteMarker) {
    throw fail("Le contenu ne contient aucune citation APA ou note identifiable.", 502);
  }

  for (const marker of normalizedContent.match(/\[\^\d+\]/g) || []) {
    if (!footnotes.some((note) => note.marker === marker)) {
      throw fail(`Le marqueur ${marker} ne possède aucune note correspondante.`, 502);
    }
  }
}

function validateResult(text, block, project) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail("La réponse OpenAI n'est pas un JSON valide.", 502);
  }

  const content = String(parsed?.content || "").trim();

  if (!content) {
    throw fail("OpenAI n'a produit aucun contenu.", 502);
  }

  const expectedWords = Math.min(
    Math.max(Number(block?.expectedWords || 1), 1),
    MAX_BLOCK_WORDS
  );

  const actualWords = countWords(content);
  const tolerance = Math.max(40, Math.round(expectedWords * 0.12));

  if (Math.abs(actualWords - expectedWords) > tolerance) {
    throw fail(
      `Le bloc contient ${actualWords} mots. La cible était ${expectedWords} mots.`,
      502
    );
  }

  const sentenceViolations = validateSentenceLength(content);

  if (sentenceViolations.length > 0) {
    throw fail(
      `Le texte ne respecte pas la limite de 20 mots par phrase : ${sentenceViolations.slice(0, 3).join(" ")}`,
      502
    );
  }

  const citationMode = detectCitationMode(project);
  const { normalized: sources, ids } = validateSources(parsed.sources);
  const footnotes = Array.isArray(parsed.footnotes) ? parsed.footnotes : [];

  validateFootnotes(footnotes, ids, citationMode);
  validateContentCitations(content, sources, footnotes, citationMode);

  return {
    id: String(parsed.id || block.id || "").trim(),
    title: String(parsed.title || block.title || "").trim(),
    content,
    wordCount: actualWords,
    sources,
    footnotes: footnotes.map((note) => ({
      number: Number(note.number),
      marker: String(note.marker),
      text: String(note.text),
      sourceId: String(note.sourceId),
    })),
  };
}

async function researchSources({
  project,
  problematic,
  plan,
  block,
  apiKey,
  fileIds,
}) {
  const researchSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      sources: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            author: { type: "string" },
            year: { type: "string" },
            title: { type: "string" },
            publisher: { type: "string" },
            url: { type: "string" },
            doi: { type: "string" },
            citation: { type: "string" },
            relevance: { type: "string" },
          },
          required: [
            "id",
            "author",
            "year",
            "title",
            "publisher",
            "url",
            "doi",
            "citation",
            "relevance",
          ],
        },
      },
    },
    required: ["sources"],
  };

  const query = `
Effectue une recherche documentaire réelle sur Internet avant toute rédaction.

Sujet :
${project?.sujet || ""}

Domaine :
${project?.domaine || ""}

Niveau :
${project?.niveau || ""}

Problématique :
${JSON.stringify(problematic || {}, null, 2)}

Plan :
${JSON.stringify(plan || {}, null, 2)}

Bloc :
${JSON.stringify(block || {}, null, 2)}

Consignes :
- Recherche des sources académiques, institutionnelles ou professionnelles fiables.
- Priorise les articles scientifiques, ouvrages identifiables, rapports officiels et publications d'organismes reconnus.
- Ne crée aucune référence.
- Ne déduis jamais un DOI, une URL, un auteur, une date ou un titre.
- Retourne uniquement des sources réellement retrouvées pendant la recherche.
- Si une information bibliographique est inconnue, laisse le champ vide.
- Ne retiens une source que si elle est pertinente pour le bloc demandé.
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
      tool_choice: "required",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Tu es un documentaliste académique. Tu dois effectuer une recherche Web réelle. Ne fabrique aucune source. Retourne uniquement le JSON demandé.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: query,
            },
            ...fileIds.map((id) => ({
              type: "input_file",
              file_id: id,
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "trimemo_research_sources",
          strict: true,
          schema: researchSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw fail(
      `La recherche documentaire a échoué. ${await response.text()}`,
      502
    );
  }

  const data = await response.json();
  const text = extractResponseText(data);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail(
      "La recherche documentaire n'a pas retourné un JSON valide.",
      502
    );
  }

  const sources = Array.isArray(parsed.sources)
    ? parsed.sources.map(normalizeSource)
    : [];

  if (sources.length === 0) {
    throw fail(
      "Aucune source pertinente et exploitable n'a été trouvée.",
      502
    );
  }

  const validSources = sources.filter(
    (source) =>
      source.id &&
      source.author &&
      source.year &&
      source.title &&
      source.citation &&
      (source.url || source.doi)
  );

  if (validSources.length === 0) {
    throw fail(
      "Les résultats de recherche ne contiennent aucune référence suffisamment identifiable.",
      502
    );
  }

  return validSources;
}

async function generateBlock({
  project,
  problematic,
  plan,
  block,
  preceding,
  apiKey,
  fileIds,
  researchSources,
}) {
  const expectedWords = Math.min(
    Math.max(Number(block?.expectedWords || 1), 1),
    MAX_BLOCK_WORDS
  );

  const citationMode = detectCitationMode(project);
  const files = fileIds.map((id) => ({
    type: "input_file",
    file_id: id,
  }));

  const sourceBundle = researchSources
    .map(
      (source) =>
        `ID: ${source.id}\nAuteur: ${source.author}\nAnnée: ${source.year}\nTitre: ${source.title}\nÉditeur: ${source.publisher}\nURL: ${source.url}\nDOI: ${source.doi}\nCitation: ${source.citation}`
    )
    .join("\n\n");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      text: {
        format: {
          type: "json_schema",
          name: "trimemo_academic_block",
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
              text: `Tu es le rédacteur académique de Trimémo.

${STYLE_RULES}

RÈGLES DE PRODUCTION
- Rédige uniquement le bloc demandé.
- Un bloc ne dépasse jamais 900 mots.
- Respecte sa position exacte dans la structure du mémoire.
- Affiche la structure complète dans le champ title.
- Utilise exclusivement les sources fournies dans le dossier documentaire.
- N'invente aucune source, aucune citation, aucune page et aucune donnée.
- Ne cite jamais une source absente du dossier documentaire.
- Si les sources ne permettent pas de soutenir une affirmation, reformule-la prudemment ou ne l'affirme pas.
- Le texte doit contenir des citations correspondant aux sources utilisées.
- En mode footnotes, chaque marqueur [^n] doit correspondre à une note existante.
- Les notes doivent être liées à une sourceId existante.
- Retourne uniquement le JSON demandé.`,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${buildContext({
                project,
                problematic,
                plan,
                block,
                preceding,
                citationMode,
              })}

DOSSIER DOCUMENTAIRE ISSU DE LA RECHERCHE RÉELLE :
${sourceBundle}

CIBLE : environ ${expectedWords} mots.

Rédige un contenu académique directement exploitable. Les citations doivent être cohérentes avec les sources du dossier documentaire.`,
            },
            ...files,
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw fail(
      `OpenAI a refusé la rédaction du bloc. ${await response.text()}`,
      502
    );
  }

  return extractResponseText(await response.json());
}


export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY est absente du serveur.",
    });
  }

  try {
    const body = req.body || {};
    const project = body.project || {};
    const problematic = body.problematic || body.problematique;
    const plan = body.plan;
    const block = body.block || {};
    const preceding = Array.isArray(body.preceding) ? body.preceding : [];

    if (!String(project.sujet || "").trim()) {
      throw fail("Le sujet est obligatoire.");
    }

    if (!problematic) {
      throw fail("La problématique est obligatoire.");
    }

    if (!plan) {
      throw fail("Le plan est obligatoire.");
    }

    if (!block.title || !Number(block.expectedWords)) {
      throw fail("Le bloc à rédiger est invalide.");
    }

    if (Number(block.expectedWords) > MAX_BLOCK_WORDS) {
      throw fail("Un bloc ne peut pas dépasser 900 mots.");
    }

    const fileIds = await uploadFiles(project.files, apiKey);

    const researchedSources = await researchSources({
      project,
      problematic,
      plan,
      block,
      apiKey,
      fileIds,
    });

    const raw = await generateBlock({
      project,
      problematic,
      plan,
      block,
      preceding,
      apiKey,
      fileIds,
      researchSources,
    });

    const result = validateResult(raw, block, project);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      error: error?.message || "Erreur lors de la rédaction du bloc.",
    });
  }
}
