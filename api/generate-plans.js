import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const WORDS_PER_PAGE = 320;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status || 400;
  return error;
}

function text(value) {
  return String(value == null ? "" : value).trim();
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

function buildContext(project, problematic, providedPlan) {
  return [
    "SUJET EXACT : " + text(project.sujet || project.subject),
    "DOMAINE : " + (text(project.domaine || project.domain) || "Non précisé"),
    "NIVEAU : " + (text(project.niveau || project.level) || "Non précisé"),
    "TYPE : " + (text(project.typeDoc || project.typeDocument || project.type) || "Non précisé"),
    "CONTEXTE : " + (text(project.contexte || project.context) || "Aucun contexte complémentaire"),
    "CONSIGNES : " + (text(project.consignes || project.instructions) || "Aucune consigne complémentaire"),
    "PROBLÉMATIQUE : " + JSON.stringify(problematic || {}),
    "PLAN FOURNI PAR LE CLIENT : " + (providedPlan || "Aucun plan fourni")
  ].join("\n\n");
}

const subsectionSchema = {
  type: "array",
  minItems: 0,
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: { title: { type: "string" } },
    required: ["title"]
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
                  description: ""
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
    "",
    "Le résultat doit ressembler à une TABLE DES MATIÈRES académique.",
    "Il ne doit pas ressembler à une liste de commentaires ou à un résumé.",
    "",
    "RÈGLES ABSOLUES :",
    "1. Respecte exactement le sujet, la problématique et les consignes fournies.",
    "2. N’invente aucun pays, terrain, institution, population, période ou résultat.",
    "3. Ne rédige aucun commentaire méthodologique dans les titres.",
    "4. Les titres doivent être courts, précis, académiques et directement liés au sujet.",
    "5. Ne mets aucune explication dans les titres.",
    "6. Chaque plan commence par Introduction générale et se termine par Conclusion générale.",
    "7. Chaque plan comporte 2 ou 3 PARTIES selon le niveau et le volume.",
    "8. Adapte la profondeur au nombre de pages : petit volume = structure courte ; grand volume = structure plus détaillée.",
    "9. Pour 1 à 20 pages : privilégie 2 parties, 1 à 2 chapitres par partie, 1 à 2 sections par chapitre et seulement les sous-sections utiles.",
    "10. Pour 21 à 50 pages : privilégie 2 parties, 2 chapitres par partie et 2 sections par chapitre.",
    "11. Au-delà de 50 pages : une structure en 2 ou 3 parties peut être utilisée avec davantage de niveaux si le sujet le justifie.",
    "12. N'ajoute jamais un niveau hiérarchique uniquement pour remplir un modèle. Supprime-le lorsqu'il provoque une répétition.",
    "13. Chaque titre doit être directement lié au sujet, à la problématique et au domaine. Évite les titres génériques répétitifs.",
    "14. Deux titres au même niveau ne doivent pas exprimer la même idée avec des synonymes.",
    "15. Le niveau d'études doit influencer la profondeur et la précision.",
    "16. Le nombre de pages doit déterminer la densité du plan. Ne produis pas un plan tiroir identique pour tous les projets.",
    "17. Les trois plans doivent proposer des angles scientifiques réellement différents lorsque trois plans sont demandés.",
    "18. Dans un même plan, varie naturellement la densité de la structure : les parties, chapitres et sections ne doivent pas tous avoir le même nombre d'éléments.",
    "19. Une partie peut avoir 2 ou 3 chapitres. Il n'est jamais obligatoire d'en avoir 3.",
    "20. Un chapitre doit avoir au moins 2 sections, mais peut en avoir 3 ou davantage si le sujet le justifie.",
    "21. Les sous-sections sont facultatives et ne doivent apparaître que lorsqu'elles apportent une vraie distinction scientifique.",
    "22. Les trois plans doivent aussi varier entre eux. Leur architecture doit être différente, pas seulement leurs titres.",
    "23. Ne reproduis jamais mécaniquement la même matrice numérique dans les trois plans.",
    "24. La variation doit découler du sujet choisi, de la problématique, du domaine, du niveau, du volume et des consignes.",
    "25. N'ajoute jamais un chapitre, une section ou une sous-section uniquement pour obtenir une symétrie visuelle.",
    "26. Si deux structures sont également cohérentes, privilégie celle qui évite la répétition et la symétrie artificielle.",
    "18. Les trois plans ne doivent surtout pas avoir la même architecture numérique.",
    "19. L'asymétrie est normale : une partie peut avoir 1 chapitre et une autre 2 ou 3.",
    "20. Une section peut avoir des sous-sections tandis qu'une autre section n'en a pas.",
    "21. Le nombre de chapitres, sections et sous-sections doit être déterminé par le contenu scientifique, pas par une grille fixe.",
    "22. Évite absolument la matrice mécanique 2 parties × 2 chapitres × 2 sections × 2 sous-sections répétée dans les trois plans.",
    "23. Pour trois plans, varie réellement la logique de construction lorsque le sujet le permet.",
    "24. Une différence de titre ne suffit pas : les niveaux et leur densité doivent aussi varier naturellement.",
    "25. Ne crée jamais une sous-section uniquement pour équilibrer visuellement une autre section.",
    "18. Si le client fournit un plan ou des consignes structurelles, respecte leur logique.",
    "19. Ne mets pas de description, justification, commentaire ou paragraphe dans la structure.",
    "20. Retourne uniquement le JSON demandé.",
    "21. Ne préfixe jamais les titres par Partie, Chapitre, Section ou Sous-section ni par leur numéro. La numérotation est ajoutée séparément par l'application."
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

    const project = body.project || body.projet || body;
    const sujet = text(project.sujet || project.subject);
    const problematic = body.problematic || body.problematique || project.problematiquePersonnelle || {};
    const providedPlan = text(body.providedPlan || project.planPersonnel);
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

    function validateArchitecture(plans) {
      if (count !== 3) return true;
      if (plans.length !== 3) return false;

      const signatures = plans.map(architectureSignature);
      const uniqueSignatures = new Set(signatures).size;
      const internalVariation = plans.every(hasInternalVariation);

      return uniqueSignatures === 3 && internalVariation;
    }

    async function requestPlans(extraInstruction) {
      const response = await fetch(OPENAI_URL, {
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
                  buildContext(project, problematic, providedPlan) +
                  "\n\nGénère exactement " + count + " plan(s)." +
                  "\n\nStructure : Introduction générale -> Partie -> Chapitre -> Section -> Sous-section facultative -> Conclusion générale." +
                  "\n\nCONTRAINTE STRUCTURELLE : 2 ou 3 parties selon le sujet. Chaque partie peut avoir 2 ou 3 chapitres. Chaque chapitre a au moins 2 sections. Les sous-sections sont facultatives." +
                  "\n\nLa variation doit être naturelle à l'intérieur de chaque plan et entre les trois plans. Elle doit découler du sujet, de la problématique, du domaine, du niveau, du volume et des consignes. Ne cherche jamais une symétrie visuelle." +
                  "\n\n" + extraInstruction +
                  "\n\nLe volume demandé est de " + expectedWords + " mots pour le développement. Il sert uniquement à répartir le travail entre les chapitres." +
                  "\n\n" + (providedPlan ? "Le plan fourni par le client est prioritaire. Conserve sa logique et ses intitulés pertinents, puis complète uniquement les niveaux hiérarchiques nécessaires." : "") +
                  "\n\nNe fournis aucun commentaire, aucune description, aucune justification. Retourne uniquement le JSON."
              }]
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
        })
      });

      const raw = await response.text();
      if (!response.ok) {
        let detail = raw;
        try { detail = JSON.stringify(JSON.parse(raw)); } catch {}
        throw fail("Erreur OpenAI pendant la génération du plan.", 502);
      }

      const parsed = parseJson(extractText(JSON.parse(raw)));
      if (!Array.isArray(parsed?.plans) || parsed.plans.length < count) {
        throw fail("OpenAI n’a pas retourné le nombre de plans demandé.", 502);
      }

      return parsed.plans.slice(0, count).map((plan, index) =>
        normalizeGeneratedPlan(plan, index, expectedWords)
      );
    }

    let plans = await requestPlans(
      count === 3
        ? "Les trois architectures doivent être distinctes. Le plan 1, le plan 2 et le plan 3 doivent chacun être construits selon la logique propre de leur angle. Évite toute répétition de la même distribution numérique."
        : "Construis une architecture adaptée au contenu réel, sans symétrie artificielle."
    );

    if (!validateArchitecture(plans)) {
      plans = await requestPlans(
        "ATTENTION : la première proposition était trop mécanique. Recommence entièrement. Pour chaque plan, change réellement la distribution des chapitres et/ou des sections lorsque le contenu le justifie. À l'intérieur de chaque plan, évite que toutes les parties et tous les chapitres aient exactement la même profondeur. Les différences doivent rester scientifiquement justifiées, jamais décoratives."
      );
    }

    if (!validateArchitecture(plans)) {
      throw fail(
        "Les plans générés restent trop symétriques. Une nouvelle génération est nécessaire pour obtenir des architectures réellement distinctes.",
        502
      );
    }

    return res.status(200).json({ plans });
  } catch (error) {
    console.error("generate-plans error", error);
    return res.status(error.status || 500).json({
      error: error.message || "Erreur interne lors de la génération des plans.",
      details: error.details
    });
  }
}
