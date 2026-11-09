import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBibliography } from '../lib/build-bibliography.js';
import { setCors } from '../lib/http.js';
import { auditCitationReferences } from '../lib/citation-audit.js';

test('bibliography merges block and project sources and deduplicates by DOI', () => {
  const result = buildBibliography({
    blocks: [{
      sources: [{
        id: 'block-source',
        author: 'Kastalli and Van Looy',
        year: 2013,
        title: 'Firm performance',
        doi: '10.1000/example',
        verified: true,
      }],
    }],
    papers: [
      {
        id: 'global-copy',
        author: 'Kastalli and Van Looy',
        year: 2013,
        title: 'Firm performance',
        doi: 'https://doi.org/10.1000/example',
      },
      {
        author: 'Milgrom and Roberts',
        year: 1995,
        title: 'Complementarities and fit',
      },
    ],
  });

  assert.equal(result.count, 2);
  assert.equal(result.sources.filter((source) => source.doi === '10.1000/example').length, 1);
  assert.ok(result.sources.some((source) => source.title === 'Complementarities and fit'));
});

test('CORS exposes export warning headers to browser JavaScript', () => {
  const headers = {};
  const res = { setHeader(name, value) { headers[name.toLowerCase()] = value; } };
  const previous = process.env.TRIMEMO_FRONTEND_URL;
  process.env.TRIMEMO_FRONTEND_URL = 'https://trimemo.example';
  try {
    setCors(res, { headers: { origin: 'https://trimemo.example' } });
  } finally {
    if (previous === undefined) delete process.env.TRIMEMO_FRONTEND_URL;
    else process.env.TRIMEMO_FRONTEND_URL = previous;
  }

  assert.match(headers['access-control-expose-headers'], /X-Trimemo-Bibliography-Warning/i);
  assert.match(headers['access-control-expose-headers'], /X-Trimemo-Citation-Issue-Count/i);
  assert.match(headers['access-control-expose-headers'], /X-Trimemo-Style-Warning/i);
});

test('citation audit matches author-year citations and explicit source identifiers', () => {
  const blocks = [{
    content: 'Les résultats suivent Kastalli et Van Looy (2013). Voir aussi [source:paper-42]. DOI complémentaire : 10.1000/example.',
  }];
  const sources = [
    {
      id: 'paper-42',
      author: 'Kastalli and Van Looy',
      year: 2013,
      title: 'Firm performance',
      doi: '10.1000/example',
    },
  ];

  const result = auditCitationReferences(blocks, sources);
  assert.equal(result.count, 0);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.unmatchedIdentifiers, []);
});

test('citation audit reports unresolved author-year, DOI and source-id references', () => {
  const result = auditCitationReferences([{
    content: 'Milgrom et Roberts (1995), [cite:missing-paper], DOI 10.5555/not-found.',
  }], []);

  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatchedIdentifiers.length, 2);
  assert.equal(result.count, 3);
});
