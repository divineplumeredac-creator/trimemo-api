import { setCors } from "../lib/http.js";
import { getOpenAIModel } from "../lib/openai-model.js";import { TRIMEMO_MASTER_ACADEMIC_RULES } from "../lib/trimemo-academic-rules.js";
import { enforceAcademicStyle } from "../lib/style-control.js";
import { TRIMEMO_BLOCK_WRITING_CONTRACT, TRIMEMO_STRICT_STYLE_CONTRACT } from "../lib/strict-writing-contract.js";
import { requireOwner } from "../lib/owner-auth.js";
import { requirePremiumOrOwner } from "../lib/premium-auth.js";
import { assertOrderUsable } from "../lib/order-ledger.js";
import { rateLimit } from "../lib/rate-limit.js";
import { hydrateProjectFiles } from "../lib/project-file-store.js";
import { buildProjectDocumentContext, buildDocumentInstructions, buildImageInputs } from "../lib/project-documents.js";
import { assertFilesSize } from "../lib/limits.js";
import { verifySources } from "../lib/verify-sources.js";
export default async function handler(req, res) {
  setCors(res, req, "POST, OPTIONS");

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
    let project = body.project || body;
    await rateLimit(req, "generate-block", 30, 60 * 60 * 1000);
    const previewMode = body.previewMode === true;
    if (body.ownerMode === true) requireOwner(req);
    else if (previewMode) {
      // Aperçu public : rédaction progressive bloc par bloc, limitée à 2 500 mots cumulés.
      const previewBlocks = Array.isArray(body.previewBlocks) ? body.previewBlocks : [];
      const previewWords = previewBlocks.reduce((sum, item) => sum + String(item?.content || "").trim().split(/\s+/u).filter(Boolean).length, 0);
      if (previewWords >= 2500) {
        const e = new Error("L’aperçu de 2 500 mots est atteint. Consultez l’aperçu et payez pour poursuivre la rédaction."); e.status = 402; throw e;
      }
      body.targetWords = Math.min(Number(body.targetWords) || 900, 2500 - previewWords, 1000);
      if (body.targetWords < 250) body.targetWords = 250;
    } else {
      const access = requirePremiumOrOwner(req, body);
      if (access.mode === "premium") {
        await assertOrderUsable(access.token, project);
        if (!project.paymentProblematicId || body.problematic?.id !== project.paymentProblematicId || !project.paymentPlanId || body.plan?.id !== project.paymentPlanId) {
          const e = new Error("Le paiement est lié à une autre problématique ou à un autre plan."); e.status = 403; throw e;
        }
      }
    }
    if (Array.isArray(project.files) && project.files.length) project = await hydrateProjectFiles(project);
    assertFilesSize(project.files);
    const documentContext = project.documentContext || await buildProjectDocumentContext(project.files);
    const imageInputs = buildImageInputs(project.files);

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

    const blockKind = String(
      body.kind ||
      body.block?.kind ||
      ""
    ).trim().toLowerCase();

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

    const isPartStart = ["part", "partie", "part_intro", "partie_intro", "part-intro", "partie-intro"].includes(blockKind);
    const isChapterStart = ["chapter", "chapitre", "chapter_intro", "chapitre_intro", "chapter-intro", "chapitre-intro"].includes(blockKind);
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
        ? (previewMode ? Math.min(Math.max(targetWords, 1), 1000) : Math.min(Math.max(targetWords, 300), 1500))
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
12 bis. Lorsque tu utilises une source, cite-la dans le texte avec une citation auteur-date correspondant à la référence retournée dans SOURCES, par exemple (Organisation internationale du Travail, 2022). N’utilise pas les seuls domaines tels que (ilo.org), (osha.gov) ou (cdc.gov) comme citations académiques finales.
12 ter. Chaque citation auteur-date du texte doit correspondre à une source retournée. N’invente jamais une correspondance bibliographique.
13. Le découpage en blocs est subordonné à la cohérence scientifique, jamais à un quota mécanique de mots.
14. Un bloc peut couvrir une section entière et toutes ses sous-sections, ou plusieurs sections consécutives lorsqu'elles forment une même unité argumentative.
15. Développe toutes les unités présentes dans STRUCTURE DU BLOC, dans leur ordre, sans en supprimer une.
RÈGLE ABSOLUE DE STRUCTURATION DES BLOCS :
Le bloc est une unité technique de génération. Il ne remplace jamais les unités scientifiques du plan.
Un objectif d’environ 900 mots ne doit jamais produire un texte continu de 900 mots sans structuration.
Toute section, sous-section ou titre interne présent dans STRUCTURE DU BLOC doit rester identifiable dans le contenu final.
Pour chaque unité, reproduis son intitulé comme intertitre, puis développe son contenu sous cet intertitre.
Si plusieurs sections sont regroupées, chacune conserve son propre titre et son développement.
Une section entière peut constituer un bloc lorsque sa cohérence scientifique le justifie.
Plusieurs sections peuvent être regroupées lorsqu’elles forment une même unité argumentative.
Une section ne doit jamais être découpée artificiellement pour atteindre 900 mots.
Les 900 mots constituent une cible indicative. Ils ne priment jamais sur la cohérence scientifique, la hiérarchie du plan et la continuité argumentative.
Ordre de priorité : cohérence scientifique > structure du plan > continuité argumentative > volume indicatif.
16. Assure une transition naturelle entre les unités regroupées. Ne crée pas de rupture artificielle pour respecter un nombre de mots.
17. Lorsque le bloc correspond au début d'une PARTIE, rédige d'abord un court paragraphe d'ouverture sous le titre de la partie. Ce paragraphe présente la logique, les enjeux et la progression de la partie vers ses chapitres. N'ajoute jamais un titre tel que « Introduction de la partie ».
18. Lorsque le bloc correspond au début d'un CHAPITRE, rédige d'abord un court paragraphe d'ouverture sous le titre du chapitre. Ce paragraphe situe l'objet du chapitre et annonce sa progression vers les sections. N'ajoute jamais un titre tel que « Introduction du chapitre ».
19. Lorsque le bloc contient le début d'une SECTION, rédige d'abord une brève introduction de section directement sous le titre de la section, avant toute sous-section. Si plusieurs sections sont regroupées dans le même bloc, chaque section doit recevoir sa propre brève introduction avant sa première sous-section. N'ajoute jamais un titre tel que « Introduction de la section ».
20. Ces ouvertures sont des paragraphes rédactionnels, pas de nouvelles unités du plan. Elles doivent rester brèves, éviter la répétition du titre et ne pas anticiper la conclusion.
20. Ne répète pas l'introduction, la problématique ou l'annonce du plan à chaque unité.
17. Assure une progression logique avec les blocs précédents.
18. Chaque paragraphe doit développer une idée principale.
19. Utilise un style rigoureux, fluide et naturel.
17. Évite les clichés rédactionnels et les formulations artificielles.
18. Évite les répétitions de connecteurs.
16. Évite les phrases trop longues et les constructions complexes.
17. Chaque phrase doit contenir au maximum 20 mots, sauf exception strictement nécessaire à la précision.
18. Contrôle et reformule avant retour chaque phrase dépassant cette limite.
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

    const fullSystemPrompt = systemPrompt + "\n\n" + TRIMEMO_MASTER_ACADEMIC_RULES + "\n\n" + TRIMEMO_BLOCK_WRITING_CONTRACT + "\n\n" + TRIMEMO_STRICT_STYLE_CONTRACT + "\n\n" + `
EXCEPTION ABSOLUE POUR LA RÉDACTION D’UN BLOC :
Le bloc doit être rédigé dès que le SUJET est disponible.
Le niveau académique, la discipline, le contexte, les consignes, le guide méthodologique et l’état d’avancement ne sont pas obligatoires lorsqu'ils sont absents.
Lorsqu'ils sont fournis, lis et applique les consignes, le guide méthodologique, le plan validé et le contexte pertinent avant de rédiger.
Ne demande jamais une information absente avant de rédiger.
Ne transforme jamais une information manquante en message de blocage.
Lorsque le niveau ou la discipline n’est pas précisé, adapte le vocabulaire au sujet et au plan effectivement fournis.
Lorsque le contexte ou les consignes manquent, rédige à partir des informations disponibles sans inventer de terrain, de données ou de résultats.
Cette exception prévaut sur toute règle générale de vérification préalable qui pourrait empêcher la rédaction.
`;

    const userPrompt = `${buildDocumentInstructions(documentContext)}\n\n` + `
PRIORITÉ DES CONSIGNES DU PROJET : le guide méthodologique et les instructions explicites du client priment sur les règles génériques. Applique-les à la rédaction de ce bloc, pas seulement au plan. Ne transforme jamais ces consignes en commentaires visibles dans le texte final.

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

FONCTION DU BLOC :
${blockKind || "Non précisée"}
Début de partie : ${isPartStart ? "OUI" : "NON"}
Début de chapitre : ${isChapterStart ? "OUI" : "NON"}
Si « Début de partie » ou « Début de chapitre » vaut OUI, l'ouverture doit être un paragraphe directement placé sous le titre concerné, sans intertitre supplémentaire.
Chaque SECTION doit également recevoir une brève introduction directement sous son titre, avant sa première sous-section. Si plusieurs sections figurent dans le bloc, répétez cette règle pour chacune.

CONTENU ET SOURCES DES BLOCS PRÉCÉDENTS :
${preceding.length ? JSON.stringify(preceding) : "Aucun bloc précédent transmis."}

SOURCES :
Recherchez les références nécessaires avant la rédaction. Retenez uniquement des sources réellement retrouvées, fiables et accessibles.
Ne réutilisez pas inutilement une source déjà présente dans les blocs précédents.
Les citations dans le texte doivent utiliser le nom de l’auteur ou de l’institution et l’année. Les domaines Web ne doivent jamais remplacer une citation auteur-date.
La rédaction finale doit permettre au document complet d’atteindre au minimum 10 références bibliographiques distinctes.
900 mots constitue une cible de confort, pas une limite ni une obligation.
Le bloc doit suivre la cohérence scientifique du plan. Il peut contenir plusieurs sections, plusieurs sous-sections et leurs titres internes. Chaque SECTION doit commencer par sa brève introduction avant ses sous-sections.
Une section ne doit pas être artificiellement découpée uniquement pour atteindre 900 mots.
Si une section est dense et scientifiquement cohérente, elle peut dépasser 900 mots.
Si plusieurs sections consécutives forment une unité argumentative cohérente, elles peuvent être regroupées dans un même bloc.

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
      console.error("OPENAI_BLOCK_PROVIDER_ERROR", { status: response.status });
      if (response.status === 429) {
        const noCredits = /no credits|insufficient_quota|quota|billing/i.test(details);
        return res.status(429).json({
          error: noCredits
            ? "Les crédits OpenAI disponibles pour la rédaction sont épuisés. Ajoutez des crédits à votre compte OpenAI avant de relancer la rédaction."
            : "Le service de rédaction OpenAI est temporairement indisponible. Veuillez réessayer plus tard.",
        });
      }
      return res.status(response.status >= 500 ? 502 : response.status).json({
        error: "Erreur OpenAI lors de la rédaction du bloc.",
      });
    }

    let result;

    try {
      const data = JSON.parse(rawText);

      if (data?.status === "incomplete") {
        console.error("OPENAI_BLOCK_INCOMPLETE", { reason: String(data?.incomplete_details?.reason || "unknown") });
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

    let correctedContent = content;
    let correctedTitle = String(result.title || blockTitle);
    let styleControl = { status: "warning", correctedFields: 0, checkedFields: 0 };
    try {
      const styleResult = await enforceAcademicStyle({ title: correctedTitle, content: correctedContent }, { apiKey, timeoutMs: 25000 });
      correctedContent = styleResult?.value?.content || correctedContent;
      correctedTitle = styleResult?.value?.title || correctedTitle;
      styleControl = { status: "passed", correctedFields: styleResult?.correctedFields || 0, checkedFields: styleResult?.checkedFields || 0 };
    } catch (styleError) {
      console.error("BLOCK_STYLE_CONTROL_FAILED", { name: String(styleError?.name || "Error"), code: String(styleError?.code || ""), message: String(styleError?.message || "unknown").slice(0, 300) });
    }
    const wordCount = correctedContent.split(/\s+/).filter(Boolean).length;
    let verifiedSources = [];
    try {
      verifiedSources = await verifySources(Array.isArray(result.sources) ? result.sources : []);
    } catch (sourceError) {
      console.error("BLOCK_SOURCE_VERIFICATION_FAILED", { name: String(sourceError?.name || "Error"), code: String(sourceError?.code || ""), message: String(sourceError?.message || "unknown").slice(0, 300) });
    }
    return res.status(200).json({
      id: String(body.block?.id || body.blockId || `block-${Date.now()}`),
      title: correctedTitle,
      content: correctedContent,
      wordCount,
      sources: verifiedSources.filter((source) => source?.verified === true),
      footnotes: Array.isArray(result.footnotes) ? result.footnotes : [],
      styleControl
    });
  } catch (error) {
    console.error("GENERATE_BLOCK_FAILED", { status: Number(error?.status) || 500, code: String(error?.code || "BLOCK_GENERATION_ERROR") });
    return res.status(Number.isInteger(error?.status) ? error.status : 500).json({
      error: error?.status === 401 || error?.status === 402 || error?.status === 403 || error?.status === 413 || error?.status === 429
        ? error.message
        : "Une erreur interne est survenue pendant la rédaction du bloc."
    });
  }
}
