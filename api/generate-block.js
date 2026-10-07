import { getOpenAIModel } from "../lib/openai-model.js";import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { buildProjectDocumentContext, buildDocumentInstructions } from "../lib/project-documents.js";
import { assertFilesSize } from "../lib/limits.js";
import { verifySources } from "../lib/verify-sources.js";
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", String(process.env.TRIMEMO_FRONTEND_URL || ""));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Trimemo-Premium-Token");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "La clé API OpenAI est absente."
    });
  }

  try {
    const body = req.body || {};
    if (body.ownerMode === true) requireOwner(req);
    else requirePremiumOrOwner(req, body);
    const project = body.project || body;
    const documentContext = await buildProjectDocumentContext(project.files);
    assertFilesSize(project.files);

    const sujet = String(
      project.sujet ||
      project.subject ||
      body.sujet ||
      ""
    ).trim();

    const domaine = String(
      project.domaine ||
      body.domaine ||
      ""
    ).trim();

    const niveau = String(
      project.niveau ||
      body.niveau ||
      ""
    ).trim();

    const typeDoc = String(
      project.typeDoc ||
      project.typeDocument ||
      body.typeDoc ||
      "Mémoire"
    ).trim();

    const contexte = String(
      project.contexte ||
      project.context ||
      ""
    ).trim();

    const consignes = String(
      project.consignes ||
      project.instructions ||
      ""
    ).trim();

    const blockTitle = String(
      body.blockTitle ||
      (typeof body.block === "string" ? body.block : body.block?.title) ||
      body.title ||
      "Introduction générale"
    ).trim();

    const problematic =
      body.problematic ||
      body.problematique ||
      project.problematiquePersonnelle ||
      "";
    const plan = body.plan || project.plan || "";
    const structure = Array.isArray(body.structure)
      ? body.structure.filter(Boolean)
      : Array.isArray(body.block?.structure)
        ? body.block.structure.filter(Boolean)
        : [];
    const preceding = Array.isArray(body.preceding)
      ? body.preceding.slice(-3)
      : [];

    const targetWords = Number(
      body.targetWords ||
      body.words ||
      900
    );

    if (!sujet) {
      return res.status(400).json({
        error: "Le sujet du projet est obligatoire."
      });
    }

    const safeWordTarget =
      Number.isFinite(targetWords) && targetWords > 0
        ? Math.min(Math.max(targetWords, 300), 1500)
        : 900;

    const systemPrompt = `
Tu es un rédacteur académique spécialisé dans la rédaction de blocs
destinés aux mémoires, rapports, thèses et travaux universitaires.

Ta mission consiste uniquement à rédiger le bloc demandé.

INSTRUCTIONS SPÉCIFIQUES DU BLOC :

1. Rédige exclusivement sur le sujet transmis.
2. Respecte la problématique et le plan sélectionnés.
3. Respecte le titre et la fonction du bloc.
4. Utilise uniquement les informations fournies ou vérifiables.
5. Ne crée aucun terrain, pays, institution ou résultat non fourni.
6. Ne présente aucune donnée inventée comme un fait.
7. Recherche des sources académiques et institutionnelles avec l’outil de recherche Web lorsque le sujet nécessite des références.
8. Pour chaque source retenue, utilise uniquement des informations réellement retrouvées dans les résultats de recherche.
9. Ne fabrique jamais d'auteur, de date, de DOI, d'URL ou de citation.
10. Privilégie les articles scientifiques, ouvrages universitaires, rapports d’institutions reconnues et documents officiels accessibles.
11. Vérifie que chaque source retenue dispose d’un DOI ou d’une URL issue de la recherche.
12. Évite les sources anciennes lorsque des travaux plus récents et pertinents existent.
13. N’utilise pas de doublons parmi les sources déjà transmises dans les blocs précédents.
9. Si une information manque, formule une analyse prudente.
10. Ne répète pas les idées déjà développées dans le bloc.
11. Les blocs précédents sont une mémoire de continuité, pas une matière à recopier.
12. N’introduis pas de nouvelle introduction, de nouvelle problématique ou de nouvelle annonce du plan si ces éléments ont déjà été traités.
13. Un bloc peut regrouper plusieurs sous-sections consécutives et leurs titres internes lorsque la structure reçue les rassemble.
14. Développe toutes les unités présentes dans STRUCTURE DU BLOC, dans leur ordre, sans en supprimer une.
15. Assure une transition naturelle entre les sous-sections regroupées. Ne crée pas de rupture artificielle entre elles.
16. Ne répète pas l'introduction, la problématique ou l'annonce du plan à chaque sous-section.
17. Assure une progression logique avec les blocs précédents.
18. Chaque paragraphe doit développer une idée principale.
19. Utilise un style rigoureux, fluide et naturel.
17. Évite les clichés rédactionnels et les formulations artificielles.
18. Évite les répétitions de connecteurs.
16. Évite les phrases trop longues et les constructions complexes.
17. La limite recommandée est de 20 mots par phrase.
18. Une phrase légèrement plus longue ne doit pas bloquer la génération.
19. N'utilise pas systématiquement « en effet », « de plus » ou « cependant ».
20. Évite l'utilisation excessive des adverbes en « -ment ».
21. Évite les pronoms « ceci » et « cela » lorsqu'ils sont inutiles.
22. Définis les sigles lors de leur première apparition.
23. Adapte le vocabulaire à la discipline réelle.
24. Ne transforme pas le sujet en un autre domaine.
25. Ne conclus pas tout le mémoire dans un seul bloc.
26. Ne produis aucun commentaire sur ton fonctionnement.
27. Retourne uniquement le contenu demandé dans le format JSON.

Le bloc doit être original, cohérent et directement exploitable
dans un travail académique.
`;

    const fullSystemPrompt = systemPrompt + "\n\n" + TRIMEMO_MASTER_ACADEMIC_RULES + "\n\n" + `
EXCEPTION ABSOLUE POUR LA RÉDACTION D’UN BLOC :
Le bloc doit être rédigé dès que le SUJET est disponible.
Le niveau académique, la discipline, le contexte, les consignes, le guide méthodologique et l’état d’avancement sont facultatifs pour lancer la rédaction du bloc.
Ne demande jamais ces informations avant de rédiger.
Ne transforme jamais une information manquante en message de blocage.
Lorsque le niveau ou la discipline n’est pas précisé, adapte le vocabulaire au sujet et au plan effectivement fournis.
Lorsque le contexte ou les consignes manquent, rédige à partir des informations disponibles sans inventer de terrain, de données ou de résultats.
Cette exception prévaut sur toute règle générale de vérification préalable qui pourrait empêcher la rédaction.
`;

    const userPrompt = `${buildDocumentInstructions(documentContext)}\n\n` + `
DONNÉES DU PROJET

Sujet :
${sujet}

Domaine :
${domaine || "Non précisé"}

Niveau :
${niveau || "Non précisé"}

Type de document :
${typeDoc}

Contexte fourni :
${contexte || "Aucun contexte complémentaire"}

Consignes :
${consignes || "Aucune consigne complémentaire"}

PROBLÉMATIQUE :
${typeof problematic === "string"
  ? problematic
  : JSON.stringify(problematic)}

PLAN :
${typeof plan === "string"
  ? plan
  : JSON.stringify(plan)}

BLOC À RÉDIGER :
${blockTitle}

STRUCTURE DU BLOC :
${structure.length ? structure.join(" > ") : "Structure fournie dans le plan"}

CONTENU ET SOURCES DES BLOCS PRÉCÉDENTS :
${preceding.length ? JSON.stringify(preceding) : "Aucun bloc précédent transmis."}

SOURCES :
Recherchez les références nécessaires avant la rédaction. Retenez uniquement des sources réellement retrouvées, fiables et accessibles.
Ne réutilisez pas inutilement une source déjà présente dans les blocs précédents.
La rédaction finale doit permettre au document complet d’atteindre au minimum 10 références bibliographiques distinctes.
Un bloc standard vise environ 900 mots. Il peut couvrir plusieurs sous-sections et leurs titres internes.

OBJECTIF DE LONGUEUR :
Environ ${safeWordTarget} mots.

TÂCHE

Rédige ce bloc avec une progression académique claire.
Respecte le sujet et le plan.
Ne force aucun contexte géographique ou institutionnel.
Ne crée aucune donnée empirique.
Utilise des références vérifiables si elles sont nécessaires.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: getOpenAIModel(),
          max_output_tokens: 12000,
          tools: [{ type: "web_search_preview" }],
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: fullSystemPrompt
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: userPrompt
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "block_response",
              strict: true,
              schema: {
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
                  footnotes: {
                    type: "array",
                    items: { type: "string" }
                  },
                  sources: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        author: {
                          type: "string"
                        },
                        year: {
                          type: "string"
                        },
                        title: {
                          type: "string"
                        },
                        doi: {
                          type: "string"
                        },
                        url: {
                          type: "string"
                        }
                      },
                      required: [
                        "author",
                        "year",
                        "title",
                        "doi",
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
                  "footnotes",
                  "sources"
                ]
              }
            }
          }
        })
      }
    );

    const rawText = await response.text();

    if (!response.ok) {
      let details = rawText.slice(0, 2000);
      try {
        const parsedError = JSON.parse(rawText);
        details = parsedError?.error?.message || parsedError?.message || details;
      } catch {}
      console.error("[Trimémo] OpenAI block error", response.status, details);
      return res.status(response.status >= 500 ? 502 : response.status).json({
        error: "Erreur OpenAI lors de la rédaction du bloc.",
      });
    }

    let result;

    try {
      const data = JSON.parse(rawText);

      if (data?.status === "incomplete") {
        console.error("[Trimémo] OpenAI incomplete block response", data?.incomplete_details);
        return res.status(502).json({
          error: "La rédaction a été interrompue avant la fin.",
          details: data?.incomplete_details?.reason || "Réponse OpenAI incomplète."
        });
      }

      const outputText =
        typeof data?.output_text === "string"
          ? data.output_text.trim()
          : Array.isArray(data?.output)
            ? data.output
                .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
                .filter((item) => item?.type === "output_text" && typeof item?.text === "string")
                .map((item) => item.text)
                .join("")
                .trim()
            : "";

      if (!outputText) {
        return res.status(502).json({
          error: "OpenAI n'a retourné aucun contenu exploitable pour ce bloc."
        });
      }

      result = JSON.parse(outputText);
    } catch (error) {
      return res.status(502).json({
        error: "La réponse OpenAI n'a pas pu être interprétée.",
      });
    }

    const content = String(result.content || "").trim();

    if (!content) {
      return res.status(502).json({
        error: "Le bloc généré est vide."
      });
    }

    const wordCount = content
      .split(/\s+/)
      .filter(Boolean)
      .length;
    const verifiedSources = await verifySources(Array.isArray(result.sources) ? result.sources : []);

    return res.status(200).json({
      id: result.id || `block-${Date.now()}`,
      title: result.title || blockTitle,
      content,
      wordCount,
      sources: verifiedSources,
      footnotes: Array.isArray(result.footnotes)
        ? result.footnotes
        : []
    });
  } catch (error) {
    console.error("[Trimémo] generate-block error", error);
    return res.status(Number.isInteger(error?.status) ? error.status : 500).json({
      error: error?.status === 401 || error?.status === 402 || error?.status === 403 || error?.status === 413
        ? error.message
        : "Une erreur interne est survenue pendant la rédaction du bloc."
    });
  }
}
