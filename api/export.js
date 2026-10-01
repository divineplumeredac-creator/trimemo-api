import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Footer,
  PageNumber,
} from 'docx';
import compileDocument from './compile-document.js';
import { resolveFormatting } from '../lib/academic-format.js';
import { titleWithNumber } from '../lib/numbering.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}
function text(value) { return value == null ? '' : String(value); }
function safeFileName(value = 'trimemo-document') {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'trimemo-document';
}
function run(value, formatting, options = {}) {
  return new TextRun({
    text: text(value),
    font: formatting.fontFamily,
    size: (options.size || formatting.bodySize) * 2,
    bold: Boolean(options.bold),
    italics: Boolean(options.italics),
  });
}
function paragraph(value, formatting, options = {}) {
  return new Paragraph({
    alignment: options.alignment || AlignmentType.JUSTIFIED,
    spacing: { line: Math.round(formatting.lineSpacing * 240), before: options.before || 0, after: options.after ?? 120 },
    children: [run(value, formatting, options)],
  });
}
function heading(value, level, formatting) {
  const size =
    level === 1 ? formatting.partSize :
    level === 2 ? formatting.chapterSize :
    level === 3 ? formatting.sectionSize :
    level === 4 ? Math.max(11, formatting.sectionSize - 1) :
    Math.max(10, formatting.sectionSize - 2);
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    keepNext: true,
    spacing: { before: 240, after: 120, line: Math.round(formatting.lineSpacing * 240) },
    children: [run(value, formatting, { bold: true, size })],
  });
}
function addContent(children, content, formatting, options = {}) {
  for (const line of text(content).split(/\r?\n/).map((v) => v.trim()).filter(Boolean)) {
    children.push(paragraph(line, formatting, options));
  }
}
function addPlan(children, plan, formatting) {
  for (const part of plan.parts || []) {
    children.push(heading(titleWithNumber(part.number, part.title), 1, formatting));
    for (const chapter of part.chapters || []) {
      children.push(heading(titleWithNumber(chapter.number, chapter.title), 2, formatting));
      for (const section of chapter.sections || []) {
        children.push(heading(titleWithNumber(section.number, section.title), 3, formatting));
        for (const subsection of section.subsections || []) {
          children.push(heading(titleWithNumber(subsection.number, subsection.title), 4, formatting));
          for (const internal of subsection.internalTitles || []) {
            children.push(heading(
              titleWithNumber(internal.number, internal.title),
              5,
              formatting
            ));
          }
        }
      }
    }
  }
}
function structureLevel(label) {
  const value = text(label).toLowerCase();
  if (value.startsWith("partie ")) return 1;
  if (value.startsWith("chapitre ")) return 2;
  if (value.startsWith("section ")) return 3;
  if (value.startsWith("sous-section ") || value.startsWith("§ ")) return 4;
  if (value.startsWith("titre interne ")) return 5;
  if (value.startsWith("introduction générale") || value.startsWith("conclusion générale")) return 1;
  return 3;
}

function addBlock(children, block, formatting, previousStructure = []) {
  const structure = Array.isArray(block.structure) ? block.structure : [];
  let common = 0;
  while (common < Math.min(previousStructure.length, structure.length) &&
         previousStructure[common] === structure[common]) {
    common += 1;
  }

  for (let index = common; index < structure.length; index += 1) {
    const label = text(structure[index]);
    if (!label) continue;
    const level = structureLevel(label);
    if (level <= 5) {
      children.push(heading(label, level, formatting));
    } else {
      children.push(paragraph(label, formatting, {
        bold: true,
        alignment: AlignmentType.LEFT,
        before: 120,
      }));
    }
  }

  if (!structure.length && block.title) {
    children.push(heading(block.title, 3, formatting));
  }

  addContent(children, block.content, formatting);

  const footnotes = Array.isArray(block.footnotes) ? block.footnotes : [];
  if (footnotes.length) {
    children.push(paragraph('Notes de bas de page', formatting, {
      bold: true,
      alignment: AlignmentType.LEFT,
    }));
    footnotes.forEach((note, index) =>
      children.push(
        paragraph(String(index + 1) + '. ' + note, formatting, {
          alignment: AlignmentType.LEFT,
        })
      )
    );
  }
}

function buildChildren(compiled, formatting) {
  const children = [];
  const subject = compiled.project?.sujet || compiled.project?.subject || 'Document académique';

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400, after: 240 },
    children: [run(subject, formatting, { bold: true, size: 16 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [run('Document académique généré avec Trimémo', formatting, { italics: true, size: 11 })],
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(heading('Problématique', 1, formatting));
  const p = compiled.problematic || {};
  addContent(children, p.title, formatting, { bold: true });
  addContent(children, p.question || p.text || p.content, formatting);

  children.push(heading('Plan retenu', 1, formatting));
  addContent(children, compiled.plan.title, formatting, { bold: true });
  addPlan(children, compiled.plan, formatting);
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(heading('Développement', 1, formatting));
  let previousStructure = [];
  for (const block of compiled.blocks) {
    addBlock(children, block, formatting, previousStructure);
    previousStructure = Array.isArray(block.structure) ? block.structure : [];
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(heading('Bibliographie', 1, formatting));
  if (!compiled.bibliography.entries.length) {
    addContent(children, 'Aucune référence bibliographique n’a été transmise ou validée.', formatting);
  } else {
    for (const entry of compiled.bibliography.entries) {
      children.push(paragraph(entry, formatting, { alignment: AlignmentType.LEFT, after: 180 }));
    }
  }
  return children;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

  try {
    const body = req.body || {};
    if (body.format && body.format !== 'docx') return res.status(400).json({ error: 'Format non pris en charge. Utilisez docx.' });

    const compiled = compileDocument(body);
    const formatting = resolveFormatting(body.formatting || {});
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: formatting.fontFamily, size: formatting.bodySize * 2 },
            paragraph: { spacing: { line: Math.round(formatting.lineSpacing * 240), after: 120 } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: Math.round(formatting.marginInches * 1440),
              right: Math.round(formatting.marginInches * 1440),
              bottom: Math.round(formatting.marginInches * 1440),
              left: Math.round(formatting.marginInches * 1440),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run('Page ', formatting, { size: 9 }),
                new TextRun({ children: [PageNumber.CURRENT], font: formatting.fontFamily, size: 18 }),
              ],
            })],
          }),
        },
        children: buildChildren(compiled, formatting),
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const title = safeFileName(compiled.project?.sujet || 'trimemo-document');
    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', 'attachment; filename="' + title + '.docx"');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Trimémo export error:', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Erreur pendant la génération du document Word.',
      details: error.details || undefined,
    });
  }
}
