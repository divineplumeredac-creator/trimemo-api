import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Footer,
  Header,
  PageNumber,
  TableOfContents,
} from 'docx';
import compileDocument from '../lib/compile-document.js';
import { resolveFormatting } from '../lib/academic-format.js';
import { requirePremiumOrOwner } from '../lib/premium-auth.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', String(process.env.TRIMEMO_FRONTEND_URL || ''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Trimemo-Premium-Token');
  res.setHeader('Access-Control-Expose-Headers', 'X-Trimemo-Bibliography-Warning, X-Trimemo-Bibliography-Count, X-Trimemo-Bibliography-Missing-Links, Content-Disposition');
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
    color: options.color,
  });
}
function paragraph(value, formatting, options = {}) {
  return new Paragraph({
    alignment: options.alignment || AlignmentType.JUSTIFIED,
    keepNext: Boolean(options.keepNext),
    indent: options.indent ? { firstLine: options.indent } : undefined,
    spacing: {
      line: Math.round(formatting.lineSpacing * 240),
      before: options.before || 0,
      after: options.after ?? 120,
    },
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

  const headingLevels = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
  };

  return new Paragraph({
    heading: headingLevels[level] || HeadingLevel.HEADING_3,
    keepNext: true,
    pageBreakBefore: level === 1,
    spacing: {
      before: level === 1 ? 360 : level === 2 ? 280 : 200,
      after: 120,
      line: Math.round(formatting.lineSpacing * 240),
    },
    children: [run(value, formatting, { bold: true, size })],
  });
}
function roman(number) {
  const values = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let n = Number(number) || 1, out = "";
  for (const [value, symbol] of values) while (n >= value) { out += symbol; n -= value; }
  return out;
}
function partTitle(part) { return 'PARTIE ' + roman(part.number) + ' : ' + text(part.title); }
function chapterTitle(chapter) { return 'CHAPITRE ' + chapter.number + ' : ' + text(chapter.title); }
function sectionTitle(chapter, section) { return 'SECTION ' + chapter.number + '.' + section.number + ' : ' + text(section.title); }
function subsectionTitle(chapter, section, subsection) {
  return 'Sous-section ' + chapter.number + '.' + section.number + '.' + subsection.number + ' : ' + text(subsection.title);
}
function internalTitle(chapter, section, subsection, internal) {
  return 'Titre interne ' + chapter.number + '.' + section.number + '.' + subsection.number + '.' + internal.number + ' : ' + text(internal.title);
}
function structureLevel(label) {
  const value = text(label).trim().toLowerCase();
  if (/^(partie|part)\s+/i.test(value)) return 1;
  if (/^chapitre\s+/i.test(value)) return 2;
  if (/^section\s+/i.test(value)) return 3;
  if (/^(sous-section|§)\s*/i.test(value)) return 4;
  if (/^titre interne\s+/i.test(value)) return 5;
  return 0;
}
function cleanAcademicText(value) {
  return text(value)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/([?&])utm_(source|medium|campaign|term|content)=[^&\s)]+/gi, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
function normalizeHeadingKey(value) {
  return cleanAcademicText(value)
    .toLowerCase()
    .replace(/^[#\s]+/, '')
    .replace(/^(partie|part|chapitre|section|sous-section|titre interne)\s+[ivxlcdm0-9.]+\s*[:.)-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function markdownHeading(line) {
  const match = text(line).match(/^\s*(#{1,5})\s+(.+?)\s*#*\s*$/);
  return match ? { level: match[1].length, title: cleanAcademicText(match[2].trim()) } : null;
}
function addContent(children, content, formatting, options = {}) {
  const lines = text(content).split(/\r?\n/);
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const value = cleanAcademicText(buffer.join(' ').replace(/\s+/g, ' '));
    if (value) children.push(paragraph(value, formatting, options));
    buffer = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = markdownHeading(line);
    if (h) {
      flush();
      children.push(heading(h.title, h.level, formatting));
    } else {
      buffer.push(line);
    }
  }
  flush();
}
function addStructuredBlock(children, block, formatting, hierarchy = {}) {
  const content = text(block.content);
  const labels = Array.isArray(block.structure) ? block.structure.filter(Boolean) : [];
  const labelByKey = new Map(
    labels
      .map((label) => [normalizeHeadingKey(label), cleanAcademicText(label)])
      .filter(([key]) => key)
  );
  const lines = content.split(/\r?\n/);
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const value = cleanAcademicText(buffer.join(' ').replace(/\s+/g, ' '));
    if (value) children.push(paragraph(value, formatting));
    buffer = [];
  };

  const emitStructuralHeading = (label) => {
    const level = structureLevel(label);
    if (!level) return;
    const key = normalizeHeadingKey(label);
    if (!key) return;

    // The heading is emitted exactly where it occurs in the generated content.
    // This keeps the opening paragraph of a PARTIE/CHAPITRE directly below
    // its heading instead of moving all structural headings before the prose.
    if (hierarchy[level] === key) return;

    children.push(heading(label, level, formatting));
    hierarchy[level] = key;
    for (let deeper = level + 1; deeper <= 5; deeper++) delete hierarchy[deeper];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }

    const markdown = markdownHeading(line);
    const plainKey = normalizeHeadingKey(line);
    const candidateKey = markdown
      ? normalizeHeadingKey(markdown.title)
      : plainKey;

    if (labelByKey.has(candidateKey)) {
      flush();
      emitStructuralHeading(labelByKey.get(candidateKey));
      continue;
    }

    if (markdown) {
      flush();
      children.push(heading(markdown.title, markdown.level, formatting));
      continue;
    }

    buffer.push(line);
  }

  flush();
}
function addPlanOutline(children, plan, formatting) {
  for (const part of plan.parts || []) {
    children.push(heading(partTitle(part), 1, formatting));
    for (const chapter of part.chapters || []) {
      children.push(heading(chapterTitle(chapter), 2, formatting));
      for (const section of chapter.sections || []) {
        children.push(heading(sectionTitle(chapter, section), 3, formatting));
        for (const subsection of section.subsections || []) {
          children.push(heading(subsectionTitle(chapter, section, subsection), 4, formatting));
          for (const internal of subsection.internalTitles || []) {
            children.push(heading(internalTitle(chapter, section, subsection, internal), 5, formatting));
          }
        }
      }
    }
  }
}
function addTitlePage(children, compiled, formatting) {
  const subject = compiled.project?.sujet || compiled.project?.subject || 'Document académique';
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400, after: 500 },
    children: [run(subject.toUpperCase(), formatting, { bold: true, size: 18 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 500 },
    children: [run('DOCUMENT ACADÉMIQUE', formatting, { bold: true, size: 14 })],
  }));
  const metadata = [
    ['Niveau', compiled.project?.niveau || compiled.project?.level],
    ['Type de document', compiled.project?.typeDoc || compiled.project?.documentType],
    ['Discipline', compiled.project?.discipline],
  ].filter(([, value]) => text(value).trim());
  for (const [label, value] of metadata) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        run(label + ' : ', formatting, { bold: true, size: 11 }),
        run(value, formatting, { size: 11 }),
      ],
    }));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));
}
function addBibliography(children, compiled, formatting) {
  children.push(heading('Bibliographie', 1, formatting));
  const entries = Array.isArray(compiled.bibliography?.entries) ? compiled.bibliography.entries : [];
  if (!entries.length) {
    addContent(children, 'Aucune référence bibliographique validée n’a été transmise.', formatting);
    return;
  }
  for (const entry of entries) {
    children.push(paragraph(entry, formatting, {
      alignment: AlignmentType.LEFT,
      after: 180,
      indent: 360,
    }));
  }
}
function buildChildren(compiled, formatting) {
  const children = [];
  addTitlePage(children, compiled, formatting);

  children.push(new TableOfContents('', {
    hyperlink: true,
    headingStyleRange: '1-4',
  }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(heading('Introduction générale', 1, formatting));
  const introductionBlocks = compiled.blocks.filter((block) => block.kind === 'introduction');
  const chapterBlocks = compiled.blocks.filter((block) => block.kind === 'chapter' || block.kind === 'part' || block.kind === 'part_intro' || block.kind === 'chapter_intro' || block.kind === 'partie_intro' || block.kind === 'chapitre_intro' || !block.kind);
  const conclusionBlocks = compiled.blocks.filter((block) => block.kind === 'conclusion');
  const hierarchy = {};

  if (introductionBlocks.length) {
    for (const block of introductionBlocks) addStructuredBlock(children, block, formatting, hierarchy);
  } else {
    const intro = compiled.plan?.introductionGeneral || compiled.plan?.introduction || {};
    if (text(intro.content)) addContent(children, intro.content, formatting);
  }

  for (const block of chapterBlocks) addStructuredBlock(children, block, formatting, hierarchy);

  if (conclusionBlocks.length) {
    children.push(heading('Conclusion générale', 1, formatting));
    for (const block of conclusionBlocks) {
      const content = text(block.content);
      addContent(children, content, formatting);
    }
  } else if (text(compiled.plan?.conclusionGeneral?.content || compiled.plan?.conclusion?.content)) {
    children.push(heading('Conclusion générale', 1, formatting));
    addContent(children, compiled.plan.conclusionGeneral?.content || compiled.plan.conclusion?.content, formatting);
  }

  addBibliography(children, compiled, formatting);
  return children;
}
function makeHeader(formatting, compiled) {
  const subject = text(compiled.project?.sujet || compiled.project?.subject);
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 0 },
      children: [run(subject, formatting, { size: 9, italics: true })],
    })],
  });
}
function makeFooter(formatting) {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        run('Page ', formatting, { size: 9 }),
        new TextRun({ children: [PageNumber.CURRENT], font: formatting.fontFamily, size: 18 }),
      ],
    })],
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

  try {
    const body = req.body || {};
    requirePremiumOrOwner(req, body);
    if (body.format && body.format !== 'docx') return res.status(400).json({ error: 'Format non pris en charge. Utilisez docx.' });

    const compiled = compileDocument(body);
    const uniqueSources = Array.isArray(compiled.bibliography?.sources) ? compiled.bibliography.sources : [];
    const missingLinks = uniqueSources.filter((source) => !source.doi && !source.url).length;
    const bibliographyWarning = uniqueSources.length < 10 || missingLinks > 0;
    res.setHeader('X-Trimemo-Bibliography-Warning', bibliographyWarning ? 'true' : 'false');
    res.setHeader('X-Trimemo-Bibliography-Count', String(uniqueSources.length));
    res.setHeader('X-Trimemo-Bibliography-Missing-Links', String(missingLinks));

    const formatting = resolveFormatting(body.formatting || {});
    const doc = new Document({
      creator: 'Trimémo',
      title: text(compiled.project?.sujet || 'Document académique'),
      subject: 'Document académique',
      description: 'Document académique structuré et mis en forme automatiquement.',
      settings: { updateFields: true },
      styles: {
        default: {
          document: {
            run: { font: formatting.fontFamily, size: formatting.bodySize * 2 },
            paragraph: {
              spacing: { line: Math.round(formatting.lineSpacing * 240), after: 120 },
            },
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
        headers: { default: makeHeader(formatting, compiled) },
        footers: { default: makeFooter(formatting) },
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
