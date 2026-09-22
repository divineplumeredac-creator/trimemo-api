export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Méthode non autorisée. Utilisez POST."
    });
  }

  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: "OPENAI_API_KEY n'est pas configurée."
    });
  }

  const b = req.body || {};

  const blockTitle =
    b.blockTitle ||
    b.block ||
    b.title ||
    "Introduction générale";

  const sujet =
    b.project?.sujet ||
    b.sujet ||
    "";

  const problematique =
    b.problematique?.titre ||
    b.problematique ||
    sujet;

  const words = Number(b.targetWords || 800);

  const niveau =
    b.project?.niveau ||
    b.niveau ||
    "Master";

  const domaine =
    b.project?.domaine ||
    b.domaine ||
    "Sciences humaines et sociales";

  const contexte =
    b.project?.contexte ||
    b.contexte ||
    "";

  const plan =
    b.plan ||
    b.selectedPlan ||
    "";

  if (!sujet.trim()) {
    return res.status(400).json({
      error: "Le sujet est obligatoire."
    });
  }

  if (!problematique || !String(problematique).trim()) {
    return res.status(400).json({
      error: "La problématique est obligatoire."
    });
  }

  const styleGuide = `
Tu es un rédacteur académique francophone spécialisé
dans la rédaction universitaire rigoureuse.

CONTEXTE DU TRAVAIL

Sujet exact : "${sujet}"
Problématique : "${problematique}"
Titre du bloc : "${blockTitle}"
Domaine : "${domaine}"
Niveau d'études : "${niveau}"
Contexte complémentaire : "${contexte}"
Plan retenu : "${plan}"

1. FIDÉLITÉ AU SUJET

- Respecter strictement le sujet exact.
- Ne jamais déformer le sens du sujet.
- Adapter la rédaction au domaine scientifique indiqué.
- Respecter la problématique et le niveau d'études.
- Ne pas introduire de concepts étrangers au sujet.
- Ne pas produire de contenu générique.

2. STYLE ACADÉMIQUE

- Adopter un style rigoureux, clair et dynamique.
- Utiliser un vocabulaire précis et adapté au domaine.
- Construire une progression logique entre les paragraphes.
- Présenter une idée principale par paragraphe.
- Relier chaque argument à la problématique.
- Éviter les répétitions et les formulations mécaniques.
- Éviter les clichés associés aux textes générés automatiquement.
- Éviter les structures artificiellement symétriques.
- Ne pas produire un simple inventaire d'idées.

3. LONGUEUR DES PHRASES

- Privilégier des phrases de 20 mots maximum.
- Lorsqu'une phrase dépasse cette limite, la reformuler ou la diviser.
- Préserver le sens scientifique pendant la reformulation.
- Ne pas interrompre la génération lorsqu'une phrase dépasse 20 mots.
- Ne pas sacrifier la précision académique pour respecter mécaniquement cette limite.
- Utiliser des phrases claires, naturelles et correctement articulées.

4. RÈGLES LINGUISTIQUES

- Éviter les adverbes en "-ment" utilisés de manière excessive.
- Éviter les connecteurs répétitifs et artificiels.
- Éviter les généralités inutiles.
- Éviter les pronoms "ceci" et "cela" lorsque leur référence est imprécise.
- Définir chaque sigle lors de sa première occurrence.
- Utiliser des transitions pertinentes.
- Éviter les phrases excessivement longues et confuses.
- Ne pas utiliser de tiret long dans le corps du texte.
- Ne pas commenter le fonctionnement de l'intelligence artificielle.
- Ne pas utiliser de formulations stéréotypées ou mécaniques.

5. ANCRAGE BÉNINOIS

- Intégrer un ancrage béninois lorsque le sujet,
  le terrain ou la problématique le justifie.
- Ne pas imposer artificiellement le contexte béninois.
- Lorsque le sujet concerne le Bénin, mobiliser les réalités
  et les références pertinentes pour ce contexte.
- Ne jamais inventer de données, de statistiques,
  d'entretiens ou de résultats de terrain.
- Ne pas énumérer systématiquement plusieurs pays.
- Utiliser les comparaisons internationales uniquement
  lorsqu'elles servent réellement l'analyse.
- Adapter l'ancrage géographique au sujet étudié.

6. ADAPTATION AU DOMAINE

- Adapter les concepts, les exemples et le vocabulaire au domaine.
- En littérature, privilégier les représentations,
  les récits, les imaginaires, la mémoire,
  la transmission et les corpus.
- En histoire, privilégier les sources,
  les périodes, les acteurs et les processus historiques.
- En philosophie, privilégier les concepts,
  les thèses, les arguments et les débats théoriques.
- En sociologie, privilégier les acteurs,
  les pratiques, les rapports sociaux et les dynamiques collectives.
- Ne pas utiliser automatiquement des termes commerciaux,
  managériaux ou technologiques.
- Employer chaque concept uniquement lorsqu'il correspond au sujet.

7. QUALITÉ ACADÉMIQUE

- Ne pas inventer de références bibliographiques.
- Ne pas inventer de citations ou de résultats de recherche.
- Distinguer les faits, les interprétations et les hypothèses.
- Éviter les affirmations absolues non justifiées.
- Maintenir une progression logique.
- Produire un contenu directement lié au bloc demandé.
- Respecter le plan lorsqu'il est fourni.

8. CONSIGNE DE RÉDACTION

Rédige environ ${words} mots.

Le texte doit être académique, cohérent et adapté
au sujet, à la problématique, au domaine et au niveau d'études.

Chaque paragraphe doit contribuer à la démonstration.

Ne fabrique aucune donnée, aucune source
et aucun résultat de terrain.
`;

  try {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
          temperature: 0.7,
          top_p: 0.9,
          presence_penalty: 0.4,
          frequency_penalty: 0.4,
          messages: [
            {
              role: "system",
              content: styleGuide
            },
            {
              role: "user",
              content: `
Sujet exact :
"${sujet}"

Problématique :
"${problematique}"

Titre du bloc :
"${blockTitle}"

Domaine :
"${domaine}"

Niveau :
"${niveau}"

Contexte complémentaire :
"${contexte}"

Plan retenu :
"${plan}"

Rédige environ ${words} mots.
Respecte toutes les instructions stylistiques et méthodologiques.
Adapte précisément le contenu au domaine.
Intègre le contexte béninois uniquement lorsque le sujet le justifie.
Ne produis aucune information inventée.
              `
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erreur OpenAI :", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "La génération OpenAI a échoué.",
        provider: "OpenAI"
      });
    }

    const content =
      data.choices?.[0]?.message?.content?.trim() || "";

    if (!content) {
      return res.status(502).json({
        error: "OpenAI a retourné une réponse vide.",
        provider: "OpenAI"
      });
    }

    return res.status(200).json({
      id: `block-${Date.now()}`,
      title: blockTitle,
      content,
      wordCount: content.split(/\s+/).length,
      sources: []
    });
  } catch (error) {
    console.error("Erreur serveur generate-block :", error);

    return res.status(500).json({
      error: "Erreur lors de la communication avec OpenAI.",
      details: error.message
    });
  }
}
