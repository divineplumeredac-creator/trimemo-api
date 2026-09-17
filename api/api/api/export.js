// api/export.js - Exports universels: bibtex, docx, pdf, vérification
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { format, papers = [], document: docText = '', title = 'Trimémo - Export' } = req.body;

    // 1. BIBTEX
    if (format === 'bibtex') {
      const bibtex = papers.map((p, i) => {
        const key = `${p.authors?.split(',')[0]?.split(' ').pop()?.toLowerCase() || 'ref'}${p.year || ''}${i}`;
        return `@article{${key},
  title = {${p.title}},
  author = {${p.authors}},
  year = {${p.year || ''}},
  journal = {${p.venue || ''}},
  url = {${p.url || ''}},
  doi = {${p.doi || ''}}
}`;
      }).join('\n\n');

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', 'attachment; filename="references.bib"');
      return res.status(200).send(bibtex);
    }

    // 2. DOCX (Word)
    if (format === 'docx') {
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: '' }),
            ...docText.split('\n\n').map(t => 
              new Paragraph({ children: [new TextRun(t)] })
            ),
            new Paragraph({ text: '' }),
            new Paragraph({ text: 'Références', heading: HeadingLevel.HEADING_2 }),
            ...papers.map(p => 
              new Paragraph({ 
                children: [new TextRun(`${p.authors} (${p.year}). ${p.title}. ${p.venue}`)],
                bullet: { level: 0 }
              })
            )
          ]
        }]
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="trimemo.docx"');
      return res.status(200).send(buffer);
    }

    // 3. VÉRIFICATION (JSON structuré pour PDF côté client)
    if (format === 'verify') {
      return res.status(200).json({
        title,
        content: docText,
        references: papers,
        verified: papers.map(p => ({
          ...p,
          status: p.doi ? 'vérifié' : 'à vérifier',
          trust: p.citations > 50 ? 'élevé' : 'moyen'
        })),
        generatedAt: new Date().toISOString()
      });
    }

    // 4. PDF = renvoie JSON, génération côté client avec jsPDF
    return res.status(200).json({
      title, 
      content: docText, 
      references: papers,
      note: 'Utilise jsPDF côté Trimémo pour générer le PDF'
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
