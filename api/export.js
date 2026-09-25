import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from 'docx';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}
function text(value) { return value == null ? '' : String(value); }
function safeFileName(value = 'trimemo-document') {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'trimemo-document';
}
function uniqueSources(papers = []) {
  const map = new Map();
  for (const paper of Array.isArray(papers) ? papers : []) {
    const title = text(paper.title || paper.name).trim();
    if (!title) continue;
    const key = `${text(paper.author || paper.authors).toLowerCase()}|${title.toLowerCase()}|${text(paper.year)}`;
    if (!map.has(key)) map.set(key, paper);
  }
  return [...map.values()].sort((a, b) => {
    const aa = text(a.author || a.authors || 'Inconnu').toLowerCase();
    const bb = text(b.author || b.authors || 'Inconnu').toLowerCase();
    return aa.localeCompare(bb, 'fr');
  });
}
function sourceLabel(source) {
  const author = text(source.author || source.authors || 'Auteur non renseigné');
  const year = text(source.year || 's. d.');
  const title = text(source.title || source.name || 'Titre non renseigné');
  const venue = text(source.venue || source.journal || source.publisher);
  const url = text(source.doi ? `https://doi.org/${source.doi}` : source.url);
  return `${author} (${year}). ${title}${venue ? `. ${venue}` : ''}${url ? `. ${url}` : ''}`;
}
function makeRun(value, formatting, options = {}) {
  return new TextRun({
    text: text(value),
    font: formatting.fontFamily,
    size: options.size || formatting.bodySize * 2,
    bold: Boolean(options.bold),
    italics: Boolean(options.italics),
  });
}
function bodyParagraph(value, formatting, options = {}) {
  return new Paragraph({
    alignment: options.alignment || AlignmentType.JUSTIFIED,
    spacing: { line: formatting.lineSpacingTwips, before: options.before || 0, after: options.after ?? 120 },
    children: [makeRun(value, formatting, options)],
  });
}
function heading(value, level, formatting) {
  const size = level === 1 ? formatting.partSize : level === 2 ? formatting.chapterSize : formatting.sectionSize;
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120, line: formatting.lineSpacingTwips },
    children: [makeRun(value, formatting, { bold: true, size: size * 2 })],
  });
}
function addTextContent(children, content, formatting) {
  for (const raw of text(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (line) children.push(bodyParagraph(line, formatting));
  }
}
function addPlanStructure(children, plan, formatting) {
  if (!plan) return;
  if (plan.introductionGeneral?.title) children.push(heading(plan.introductionGeneral.title, 3, formatting));
  for (const part of plan.parts || []) {
    children.push(heading(`${part.number || ''}. ${text(part.title)}`.trim(), 1, formatting));
    for (const chapter of part.chapters || []) {
      children.push(heading(`${chapter.number || ''}. ${text(chapter.title)}`.trim(), 2, formatting));
      for (const section of chapter.sections || []) {
        children.push(heading(`${section.number || ''}. ${text(section.title)}`.trim(), 3, formatting));
        for (const subsection of section.subsections || []) {
          children.push(bodyParagraph(`${subsection.number || ''}. ${text(subsection.title)}`.trim(), formatting, { bold: true, alignment: AlignmentType.LEFT }));
        }
      }
    }
  }
  if (plan.conclusionGeneral?.title) children.push(heading(plan.conclusionGeneral.title, 3, formatting));
}
function buildAcademicChildren(body, formatting) {
  const children = [];
  const subject = text(body.project?.sujet || body.project?.subject || body.title || 'Document académique');
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 240 }, children: [makeRun(subject, formatting, { bold: true, size: 28 })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [makeRun('Document académique généré avec Trimémo', formatting, { italics: true, size: 22 })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(heading('Problématique', 1, formatting));
  const p = body.problematic || {};
  if (p.title) children.push(bodyParagraph(p.title, formatting, { bold: true }));
  addTextContent(children, p.question || p.text || p.content, formatting);

  children.push(heading('Plan retenu', 1, formatting));
  if (body.plan?.title) children.push(bodyParagraph(body.plan.title, formatting, { bold: true }));
  addPlanStructure(children, body.plan, formatting);
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(heading('Développement', 1, formatting));
  for (const block of Array.isArray(body.blocks) ? body.blocks : []) {
    const structure = Array.isArray(block.structure) ? block.structure : [];
    if (structure.length) {
      for (let i = 0; i < structure.length; i += 1) {
        const value = text(structure[i]).trim();
        if (!value) continue;
        const level = i === 0 ? 1 : i === 1 ? 2 : 3;
        children.push(heading(value.replace(/^#+\s*/, ''), level, formatting));
      }
    } else if (block.title) {
      children.push(heading(block.title, block.kind === 'chapter' ? 2 : 1, formatting));
    }
    addTextContent(children, block.content || block.text || block.body, formatting);
    if (Array.isArray(block.footnotes) && block.footnotes.length) {
      children.push(bodyParagraph('Notes', formatting, { bold: true, alignment: AlignmentType.LEFT }));
      block.footnotes.forEach((note, index) => children.push(bodyParagraph(`${index + 1}. ${note}`, formatting, { alignment: AlignmentType.LEFT })));
    }
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(heading('Bibliographie', 1, formatting));
  const sources = uniqueSources(body.papers || (body.blocks || []).flatMap((block) => block.sources || []));
  if (!sources.length) {
    children.push(bodyParagraph('Aucune référence bibliographique n’a été transmise ou validée. Les références doivent être complétées et vérifiées avant dépôt.', formatting));
  } else {
    sources.forEach((source) => children.push(bodyParagraph(sourceLabel(source), formatting, { alignment: AlignmentType.LEFT, after: 180 })));
  }
  return children;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  try {
    const body = req.body || {};
    if (body.format !== 'docx') return res.status(400).json({ error: 'Format non pris en charge. Utilisez docx.' });
    const incoming = body.formatting || {};
    const formatting = {
      fontFamily: incoming.fontFamily || 'Times New Roman',
      bodySize: Number(incoming.bodySize || 12),
      partSize: Number(incoming.partSize || 14),
      chapterSize: Number(incoming.chapterSize || 13),
      sectionSize: Number(incoming.sectionSize || 12),
      lineSpacingTwips: Math.round(Number(incoming.lineSpacing || 1.5) * 240),
    };
    const children = buildAcademicChildren(body, formatting);
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: formatting.fontFamily, size: formatting.bodySize * 2 },
            paragraph: { spacing: { line: formatting.lineSpacingTwips, after: 120 } },
          },
        },
      },
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [makeRun('Trimémo', formatting, { size: 18, italics: true })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [makeRun('Page ', formatting, { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: formatting.fontFamily, size: 18 })] })] }) },
        children,
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    const title = safeFileName(body.project?.sujet || body.title || 'trimemo-document');
    res.setHeader('Content-Type', DOCX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${title}.docx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Erreur interne pendant la génération du document Word.', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
}
