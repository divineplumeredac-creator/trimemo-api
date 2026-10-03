/**
 * Project-local document context.
 *
 * A methodology guide is never promoted to global Trimemo instructions.
 * Each uploaded file remains attached to the current project only.
 */

export const FILE_CATEGORIES = [
  "methodology",
  "instructions",
  "context",
  "source",
  "reference",
];

export function normalizeFileCategory(file) {
  const explicit = String(file?.category || "").trim().toLowerCase();
  if (FILE_CATEGORIES.includes(explicit)) return explicit;

  const name = String(file?.name || "").toLowerCase();
  if (/(methodolog|méthodolog|guide|consigne|instruction|norme|format|jury)/i.test(name)) {
    return "methodology";
  }

  return "reference";
}

function extractDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function extractFileText(file) {
  if (!file?.content) return "";
  const decoded = extractDataUrl(file.content);
  if (!decoded) return "";

  const name = String(file.name || "").toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return decoded.buffer.toString("utf8");
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: decoded.buffer });
    return result.value || "";
  }

  if (name.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(decoded.buffer);
    return result.text || "";
  }

  return "";
}

export async function buildProjectDocumentContext(files) {
  const grouped = {
    methodology: [],
    instructions: [],
    context: [],
    source: [],
    reference: [],
  };

  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.content) continue;
    const category = normalizeFileCategory(file);
    try {
      const content = await extractFileText(file);
      if (content.trim()) {
        grouped[category].push(
          "DOCUMENT : " + (file.name || "document") + "\n" + content.trim()
        );
      }
    } catch (error) {
      const e = new Error(
        "Impossible de lire le document du projet " + (file.name || "document") + "."
      );
      e.status = 422;
      throw e;
    }
  }

  return {
    methodologyText: grouped.methodology.join("\n\n"),
    instructionsText: grouped.instructions.join("\n\n"),
    contextText: grouped.context.join("\n\n"),
    sourcesText: grouped.source.join("\n\n"),
    referencesText: grouped.reference.join("\n\n"),
    allText: Object.values(grouped).flat().join("\n\n"),
    counts: Object.fromEntries(
      Object.entries(grouped).map(([key, value]) => [key, value.length])
    ),
  };
}

export async function uploadProjectFiles(files, apiKey) {
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
      const error = new Error(
        "Impossible de transmettre le fichier " + (file.name || "document") + " à OpenAI."
      );
      error.status = 502;
      throw error;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      const error = new Error("La réponse du service de fichiers OpenAI est invalide.");
      error.status = 502;
      throw error;
    }

    if (data?.id) uploadedIds.push(data.id);
  }

  return uploadedIds;
}

export function buildDocumentInstructions(documentContext) {
  const context = documentContext || {};
  return [
    context.methodologyText
      ? "GUIDE MÉTHODOLOGIQUE DU PROJET (PRIORITAIRE, LOCAL À CE PROJET) :\n" + context.methodologyText
      : "AUCUN GUIDE MÉTHODOLOGIQUE DU PROJET N'A ÉTÉ FOURNI.",
    context.instructionsText
      ? "DOCUMENTS D'INSTRUCTIONS DU PROJET :\n" + context.instructionsText
      : "",
    context.contextText
      ? "DOCUMENTS DE CONTEXTE DU PROJET :\n" + context.contextText
      : "",
    context.sourcesText
      ? "SOURCES FOURNIES PAR LE PROJET :\n" + context.sourcesText
      : "",
    context.referencesText
      ? "DOCUMENTS DE RÉFÉRENCE DU PROJET :\n" + context.referencesText
      : "",
  ].filter(Boolean).join("\n\n");
}
