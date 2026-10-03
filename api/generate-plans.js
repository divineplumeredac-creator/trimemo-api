import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status || 400;
  return error;
}

function text(value) {
  return String(value == null ? "" : value).trim();
}


function extractDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function extractDocumentText(files) {
  const chunks = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.content) continue;
    const decoded = extractDataUrl(file.content);
    if (!decoded) continue;
    const name = String(file.name || "document").toLowerCase();
    try {
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        chunks.push("DOCUMENT : " + file.name + "\n" + decoded.buffer.toString("utf8"));
      } else if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: decoded.buffer });
        chunks.push("DOCUMENT : " + file.name + "\n" + result.value);
      } else if (name.endsWith(".pdf")) {
        const pdfParse = (await import("pdf-parse")).default;
        const result = await pdfParse(decoded.buffer);
        chunks.push("DOCUMENT : " + file.name + "\n" + result.text);
      }
    } catch (error) {
      throw fail("Impossible de lire le document méthodologique " + file.name + ".", 422);
    }
  }
  return chunks.join("\n\n");
}

function truncateDocumentText(value, maxChars = 90000) {
  const textValue = String(value || "");
  return textValue.length > maxChars
    ? textValue.slice(0, maxChars) + "\n[Fin du document tronquée côté serveur]"
    : textValue;
}

async function uploadProjectFiles(files, apiKey) {
  const uploadedIds = [];
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
      headers: { Authorization: "Bearer " + apiKey },
      body: form,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw fail(
        "Impossible de transmettre le fichier " + (file.name || "document") + " à OpenAI.",
        502
      );
    }
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw fail("La réponse du service de fichiers OpenAI est invalide.", 502);
    }
    if (data?.id) uploadedIds.push(data.id);
  }
  return uploadedIds;
}

function cleanStructuralTitle(value, kind, fallback) {
  const raw = text(value);
  if (!raw) return fallback;
  const patterns = {
    part: /^part(?:ie)?\s+(?:[IVXLCDM]+|\d+)\s*[.\-–—:]?\s*/i,
    chapter: /^chap(?:itre|ter)?\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,
    section: /^section\s+\d+(?:\.\d+)?\s*[.\-–—:]?\s*/i,
    subsection: /^sous[- ]section\s+\d+(?:\.\d+)*\s*[.\-–—:]?\s*/i
  };
  return raw.replace(patterns[kind], "").trim() || fallback;
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = Array.isArray(data?.output) ? data.output.flatMap(function(item) {
    return Array.isArray(item?.content) ? item.content : [];
  }) : [];
  const value = parts.filter(function(part) {
    return part?.type === "output_text" && typeof part.text === "string";
  }).map(function(part) {
    return part.text;
  }).join("").trim();
  if (!value) throw fail("OpenAI n’a retourné aucun plan exploitable.", 502);
  return value;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(value.slice(start, end + 1)); } catch (ignored) {}
    }
    throw fail("La réponse OpenAI n’est pas un JSON valide.", 502);
  }
}

function buildContext(project, problematic, providedPlan, methodologyText = "") {
  return [
    "SUJET EXACT : " + text(project.sujet || project.subject),
    "DOMAINE : " + (text(project.domaine || project.domain) || "Non précisé"),
    "NIVEAU : " + (text(project.niveau || project.level) || "Non précisé"),
    "TYPE : " + (text(project.typeDoc || project.typeDocument || project.type) || "Non précisé"),
    "CONTEXTE : " + (text(project.contexte || project.context) || "Aucun contexte complémentaire"),
    "CONSIGNES : " + (text(project.consignes || project.instructions) || "Aucune consigne complémentaire"),
    "PROBLÉMATIQUE : " + JSON.stringify(problematic || {}),
    "PLAN FOURNI PAR LE CLIENT : " + (providedPlan || "Aucun plan fourni"),
    methodologyText
      ? "GUIDE(S) ET DOCUMENT(S) DE RÉFÉRENCE LUS PAR LE SERVEUR :\n" + truncateDocumentText(methodologyText)
      : "Aucun document de référence exploitable n'a été transmis."
  ].join("\n\n");
}

const internalTitleSchema = {
  type: "array",
  minItems: 0,
  maxItems: 4,
  items: {
    type: "object",
    additionalProperties: false,
    properties: { title: { type: "string" } },
    required: ["title"]
  }
};

const subsectionSchema = {
  type: "array",
  minItems: 0,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      internalTitles: internalTitleSchema
    },
    required: ["title", "internalTitles"]
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
      title: { type: "string" },
      subsections: subsectionSchema
    },
    required: ["title", "subsections"]
  }
};

const chapterSchema = {
  type: "array",
  minItems: 2,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      sections: sectionSchema
    },
    required: ["title", "sections"]
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
      title: { type: "string" },
      chapters: chapterSchema
    },
    required: ["title", "chapters"]
  }
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
          title: { type: "string" },
          approach: { type: "string" },
          parts: partSchema
        },
        required: ["title", "approach", "parts"]
      }
    }
  },
  required: ["plans"]
};

function distributeWords(totalWords, chapters) {
  const safeTotal = Math.max(chapters.length, Number(totalWords) || 0);
  const base = Math.floor(safeTotal / chapters.length);
  let remainder = safeTotal - base * chapters.length;
  return chapters.map(function() {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return value;
  });
}

function normalizeGeneratedPlan(raw, index, expectedWords) {
  const rawParts = Array.isArray(raw?.parts) ? raw.parts : [];
  if (rawParts.length < 2) throw fail("Le plan " + (index + 1) + " ne contient pas au moins deux parties.", 502);

  const parts = rawParts.map(function(part, partIndex) {
    const partNumber = partIndex + 1;
    const chapters = Array.isArray(part?.chapters) ? part.chapters : [];
    if (chapters.length < 2) throw fail("La partie " + partNumber + " du plan " + (index + 1) + " doit contenir au moins deux chapitres.", 502);

    return {
      id: "plan-" + (index + 1) + "-part-" + partNumber,
      number: partNumber,
      title: cleanStructuralTitle(part.title, "part", "Partie " + partNumber),
      description: "",
      chapters: chapters.map(function(chapter, chapterIndex) {
        const chapterNumber = chapterIndex + 1;
        const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
        if (sections.length < 2) throw fail("Le chapitre " + partNumber + "." + chapterNumber + " du plan " + (index + 1) + " doit contenir au moins deux sections.", 502);

        return {
          id: "plan-" + (index + 1) + "-part-" + partNumber + "-chapter-" + chapterNumber,
          number: chapterNumber,
          title: cleanStructuralTitle(chapter.title, "chapter", "Chapitre " + chapterNumber),
          description: "",
          wordCount: 0,
          sections: sections.map(function(section, sectionIndex) {
            const sectionNumber = sectionIndex + 1;
            const subsections = Array.isArray(section?.subsections) ? section.subsections : [];
            if (!Array.isArray(subsections)) throw fail("Structure de section invalide dans le plan " + (index + 1) + ".", 502);

            return {
              id: "plan-" + (index + 1) + "-part-" + partNumber + "-chapter-" + chapterNumber + "-section-" + sectionNumber,
              number: sectionNumber,
              title: cleanStructuralTitle(section.title, "section", "Section " + sectionNumber),
              description: "",
              subsections: subsections.map(function(subsection, subsectionIndex) {
                return {
                  id: "plan-" + (index + 1) + "-part-" + partNumber + "-chapter-" + chapterNumber + "-section-" + sectionNumber + "-sub-" + (subsectionIndex + 1),
                  number: subsectionIndex + 1,
                  title: cleanStructuralTitle(subsection?.title, "subsection", "Sous-section " + (subsectionIndex + 1)),
                  description: "",
                  internalTitles: (Array.isArray(subsection?.internalTitles) ? subsection.internalTitles : []).map(function(item, internalIndex) {
                    return {
                      id: "plan-" + (index + 1) + "-part-" + partNumber + "-chapter-" + chapterNumber + "-section-" + sectionNumber + "-sub-" + (subsectionIndex + 1) + "-internal-" + (internalIndex + 1),
                      number: internalIndex + 1,
                      title: text(item?.title) || "Titre interne " + (internalIndex + 1)
                    };
                  })
                };
              })
            };
          })
        };
      })
    };
  });

  const chapters = parts.flatMap(function(part) { return part.chapters; });
  const wordCounts = distributeWords(expectedWords, chapters);
  let cursor = 0;
  for (const part of parts) {
    for (const chapter of part.chapters) chapter.wordCount = wordCounts[cursor++] || 0;
  }

  const introductionWords = Math.max(300, Math.round(expectedWords * 0.10));
  const conclusionWords = Math.min(700, Math.max(250, Math.round(expectedWords * 0.06)));

  return {
    id: "plan-" + (index + 1),
    title: text(raw.title) || "Plan " + (index + 1),
    description: "",
    approach: text(raw.approach) || "Structure académique",
    totalWords: expectedWords,
    introductionGeneral: { title: "Introduction générale", description: "", wordCount: introductionWords },
    parts: parts,
    conclusionGeneral: { title: "Conclusion générale", description: "", wordCount: conclusionWords },
    introduction: { title: "Introduction générale", description: "", wordCount: introductionWords },
    conclusion: { title: "Conclusion générale", description: "", wordCount: conclusionWords }
  };
}

function systemPrompt() {
  return [
    "Tu conçois des plans universitaires destinés à des mémoires, rapports et thèses.",
    "Le résultat doit ressembler à une table des matières académique.",
    "Les niveaux PARTIE, CHAPITRE, SECTION et SOUS-SECTION doivent rester strictement distincts.",
    "Les titres ne doivent contenir ni numéro ni préfixe de niveau : la numérotation est ajoutée par l'application.",
    "Respecte exactement le sujet, la problématique, le domaine, le niveau, le volume et les consignes.",
    "Ne crée aucun contexte, pays, terrain, institution, population ou résultat non fourni.",
    "Retourne uniquement le JSON demandé.",
    TRIMEMO_MASTER_ACADEMIC_RULES
  ].join("\n");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY est absente du serveur." });

  try {
    const body = req.body || {};
    if (body.ownerMode === true) requireOwner(req);
    else if (body.freePreview === true && Number(body.count || 1) === 1) {
      // Aperçu public limité : une seule proposition, sans accès aux fonctionnalités premium.
    } else requirePremiumOrOwner(req, body);

    const project = body.project || body.projet || body;
    const sujet = text(project.sujet || project.subject);
    const problematic = body.problematic || body.problematique || project.problematiquePersonnelle || {};
    const providedPlan = text(body.providedPlan || project.planPersonnel);
    const variationInstructions = text(body.variationInstructions);
    const count = Number(body.count) === 1 ? 1 : 3;
    const pages = Number(project.pages) || 30;
    const expectedWords = Math.max(640, pages * WORDS_PER_PAGE);

    if (!sujet) return res.status(400).json({ error: "Le sujet est obligatoire." });

    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

    function architectureSignature(plan) {
      return (plan.parts || []).map((part) =>
        (part.chapters || []).map((chapter) =>
          (chapter.sections || []).map((section) => (section.subsections || []).length).join(".")
        ).join("|")
      ).join("/");
    }

    function hasInternalVariation(plan) {
      const partChapterCounts = (plan.parts || []).map((part) => (part.chapters || []).length);
      const sectionCounts = (plan.parts || []).flatMap((part) =>
        (part.chapters || []).map((chapter) => (chapter.sections || []).length)
      );
      const subsectionCounts = (plan.parts || []).flatMap((part) =>
        (part.chapters || []).flatMap((chapter) =>
          (chapter.sections || []).map((section) => (section.subsections || []).length)
        )
      );

      return new Set(partChapterCounts).size > 1 ||
        new Set(sectionCounts).size > 1 ||
        new Set(subsectionCounts).size > 1;
    }

    function hasDensityCompliance(plan) {
      for (const part of plan.parts || []) {
        for (const chapter of part.chapters || []) {
          const sections = chapter.sections || [];
          const sectionEstimate = chapter.wordCount / Math.max(1, sections.length);
          for (const section of sections) {
            const subsections = section.subsections || [];
            if (sectionEstimate > 320 && subsections.length < 1) return false;
            if (!subsections.length) continue;
            const subsectionEstimate = sectionEstimate / subsections.length;
            if (subsectionEstimate > 320) {
              for (const subsection of subsections) {
                if ((subsection.internalTitles || []).length < 2) return false;
              }
            }
          }
        }
      }
      return true;
    }

    function validateArchitecture(plans) {
      // La densité guide le modèle mais ne doit jamais bloquer une génération valide.
      // La subdivision est contrôlée par le prompt et par la structure retournée.
      const densityCompliance = plans.every(hasDensityCompliance);
      if (count !== 3) return true;
      if (plans.length !== 3) return false;

      const signatures = plans.map(architectureSignature);
      const uniqueSignatures = new Set(signatures).size;
      const internalVariation = plans.every(hasInternalVariation);

      // Sauf lorsqu'un plan client impose explicitement une structure à 3 parties,
      // les trois propositions ne doivent pas toutes reprendre mécaniquement 3 parties.
      // Au moins une proposition doit pouvoir retenir 2 parties lorsque le sujet le justifie.
      const allThreeParts = plans.every((plan) => (plan.parts || []).length === 3);
      const providedPlanForcesThreeParts =
        Boolean(providedPlan) &&
        ((providedPlan.match(/partie/gi) || []).length >= 3);

      return uniqueSignatures === 3 &&
        internalVariation &&
        (!allThreeParts || providedPlanForcesThreeParts);
    }

    async function requestPlans(extraInstruction, fileIds = [], requestedCount = count, methodologyText = "") {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 240000);
      let response;
      try {
        response = await fetch(OPENAI_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey
          },
          body: JSON.stringify({
            model,
            input: [
              {
                role: "system",
                content: [{ type: "input_text", text: systemPrompt() }]
              },
              {
                role: "user",
                content: [{
                  type: "input_text",
                  text:
                    buildContext(project, problematic, providedPlan, methodologyText) +
                    "\n\nDOCUMENTS FOURNIS PAR LE CLIENT : le serveur a extrait leur texte et l'injecte dans le contexte. Tu dois réellement appliquer leurs règles. Le guide méthodologique de l'établissement est prioritaire sur les règles génériques de Trimémo lorsqu'il précise une structure, une méthode, une pagination, une norme de citation ou une organisation particulière. Ne remplace jamais le guide par une structure académique générique." +
                    "\n\nGénère exactement " + requestedCount + " plan(s)." +
                    "\n\nStructure : Introduction générale -> Partie -> Chapitre -> Section -> Sous-section facultative -> Conclusion générale." +
                    "\n\nCONTRAINTE STRUCTURELLE : 2 ou 3 parties selon le sujet. Chaque partie peut avoir 2 ou 3 chapitres. Chaque chapitre a au moins 2 sections. Les sous-sections sont facultatives." +
                    "\n\nLa variation doit être naturelle à l'intérieur de chaque plan et entre les trois plans. Elle doit découler du sujet, de la problématique, du domaine, du niveau, du volume et des consignes. Ne cherche jamais une symétrie visuelle." +
                    "\n\n" + extraInstruction +
                    (variationInstructions ? "\n\nINSTRUCTION DE VARIATION POUR CETTE PROPOSITION : " + variationInstructions : "") +
                    "\n\nLe volume demandé est de " + expectedWords + " mots pour le développement. Il sert uniquement à répartir le travail entre les chapitres. Il ne doit jamais remplacer les contraintes du guide méthodologique." +
                    "\n\n" + (providedPlan ? "Le plan fourni par le client est prioritaire. Conserve sa logique et ses intitulés pertinents, puis complète uniquement les niveaux hiérarchiques nécessaires." : "") +
                    "\n\nNe fournis aucun commentaire, aucune description, aucune justification. Retourne uniquement le JSON."
                  },
                  ...fileIds.map((fileId) => ({
                    type: "input_file",
                    file_id: fileId,
                  })),
                ]
              }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "trimemo_academic_toc",
                strict: true,
                schema: SCHEMA
              }
            }
          }),
          signal: controller.signal
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          throw fail("La génération du plan a dépassé 240 secondes. Réessayez.", 504);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      const raw = await response.text();
      if (!response.ok) {
        let detail = raw;
        try { detail = JSON.stringify(JSON.parse(raw)); } catch {}
        throw fail("Erreur OpenAI pendant la génération du plan. " + detail, 502);
      }

      const parsed = parseJson(extractText(JSON.parse(raw)));
      if (!Array.isArray(parsed?.plans) || parsed.plans.length < requestedCount) {
        throw fail("OpenAI n’a pas retourné le nombre de plans demandé.", 502);
      }

      return parsed.plans.slice(0, requestedCount).map((plan, index) =>
        normalizeGeneratedPlan(plan, index, expectedWords)
      );
    }

    const methodologyText = await extractDocumentText(project.files);
    const fileIds = await uploadProjectFiles(project.files, apiKey);

    const instructions = [
      "Construis la première architecture selon la logique principale du sujet et de la problématique. Ne copie pas une matrice générique.",
      "Construis une deuxième architecture réellement distincte. Modifie la logique de progression et la distribution des chapitres ou sections lorsque le sujet le permet.",
      "Construis une troisième architecture distincte. Ne reprends pas mécaniquement la structure précédente. Privilégie une logique scientifique propre à la problématique."
    ];

    const generated = await requestPlans(
      [
        "Génère les trois propositions dans UNE SEULE réponse.",
        "Plan 1 : logique principale directement adaptée au sujet et à la problématique.",
        "Plan 2 : architecture réellement distincte, avec une progression scientifique différente.",
        "Plan 3 : architecture distincte, sans reprendre mécaniquement les deux précédentes.",
        "Les trois plans doivent rester cohérents avec les consignes et le guide client."
      ].join("\n"),
      fileIds,
      count,
      methodologyText
    );

    if (!validateArchitecture(generated)) {
      throw fail("Les trois plans générés ne respectent pas suffisamment la variation structurelle demandée. Réessayez.", 502);
    }

    const plans = generated.map((plan, index) => {
      plan.id = "plan-" + (index + 1);
      return plan;
    });

    return res.status(200).json({ plans });
  } catch (error) {
    console.error("generate-plans error", error);
    return res.status(error.status || 500).json({
      error: error.message || "Erreur interne lors de la génération des plans.",
      details: error.details
    });
  }
}
