import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaseImport } from '../src/case-data.js';
import { createDemoDocuments, demoCaseMeta } from '../src/demo.js';

const backup = () => ({ schemaVersion: 1, id: 'case-1', name: 'Resident case', documents: [{ id: 'doc-1', name: 'Bill.txt', type: 'bill', pages: [{ pageNumber: 1, text: 'Water charge: $5' }], records: [{ id: 'record-1', kind: 'bill', date: '2026-01-01', waterCharge: 5, source: { documentId: 'doc-1', page: 1, quote: 'Water charge: $5' } }] }] });

test('normalizes a valid backup without mutating its source or losing extra JSON fields', () => {
  const input = backup(); input.documents[0].records[0].extraEvidence = { label: 'resident annotation', values: [false, null, 2] };
  const result = validateCaseImport(input);
  assert.equal(result.demo, false); assert.equal(result.originalFilesIncluded, false);
  assert.equal(result.documents[0].records[0].confidence, 'needs-review');
  assert.deepEqual(result.documents[0].records[0].extraEvidence, input.documents[0].records[0].extraEvidence);
  result.documents[0].pages[0].text = 'Edited';
  assert.equal(input.documents[0].pages[0].text, 'Water charge: $5');
  assert.equal(input.demo, undefined);
});

test('restores the fictional demo format including its non-UUID ID', () => {
  const demo = { ...demoCaseMeta, demo: true, schemaVersion: 1, documents: createDemoDocuments() };
  assert.equal(validateCaseImport(demo).id, 'demo-4821');
});

test('rejects case shapes that would persist a broken workspace', () => {
  for (const change of [data => delete data.id, data => { data.documents[0].pages = []; }, data => { data.documents[0].records = [null]; }, data => { data.documents[0].records[0].kind = 'script'; }]) {
    const data = backup(); change(data); assert.throws(() => validateCaseImport(data), /Case data is invalid/);
  }
});

test('rejects ID collisions and invalid source references', () => {
  const duplicateDocument = backup(); duplicateDocument.documents.push(structuredClone(duplicateDocument.documents[0]));
  assert.throws(() => validateCaseImport(duplicateDocument), /document IDs must be unique/);
  const duplicateRecord = backup(); duplicateRecord.documents[0].records.push(structuredClone(duplicateRecord.documents[0].records[0]));
  assert.throws(() => validateCaseImport(duplicateRecord), /record IDs must be unique/);
  const duplicatePage = backup(); duplicatePage.documents[0].pages.push({ pageNumber: 1, text: '' });
  assert.throws(() => validateCaseImport(duplicatePage), /page numbers must be unique/);
  for (const source of [{ documentId: 'other', page: 1, quote: 'x' }, { documentId: 'doc-1', page: 2, quote: 'x' }]) {
    const data = backup(); data.documents[0].records[0].source = source;
    assert.throws(() => validateCaseImport(data), /record sources must reference/);
  }
});

test('rejects impossible dates and nonnumeric amounts instead of silently coercing them', () => {
  for (const [field, value] of [['date', '2026-02-30'], ['waterCharge', '5'], ['usage', Infinity], ['accountLast4', '123'], ['periodStart', '2026-1-1']]) {
    const data = backup(); data.documents[0].records[0][field] = value;
    assert.throws(() => validateCaseImport(data), /Case data is invalid/);
  }
});

test('preserves unknown evidence and optional null fields for later manual review', () => {
  const data = backup(); Object.assign(data.documents[0].records[0], { rate: null, date: null, source: null });
  const result = validateCaseImport(data);
  assert.equal(result.documents[0].records[0].source, null);
  assert.equal(result.documents[0].records[0].rate, null);
});

test('rejects excessive page text, document counts and nested structures', () => {
  const data = backup(); data.documents[0].pages[0].text = 'x'.repeat(80_001);
  assert.throws(() => validateCaseImport(data), /page text/);
  const many = backup(); many.documents = Array.from({ length: 201 }, (_, i) => ({ id: `d${i}` }));
  assert.throws(() => validateCaseImport(many), /at most 200/);
  const nested = backup(); let current = nested; for (let i = 0; i < 40; i++) current = current.child = {};
  assert.throws(() => validateCaseImport(nested), /too complex/);
});

test('rejects non-JSON values, reserved keys, and cycles', () => {
  const reserved = JSON.parse(JSON.stringify(backup()).replace('"name":"Resident case"', '"name":"Resident case","__proto__":{"poisoned":true}'));
  assert.throws(() => validateCaseImport(reserved), /reserved object keys/);
  const cycle = backup(); cycle.extra = cycle;
  assert.throws(() => validateCaseImport(cycle), /cycles/);
  const executable = backup(); executable.extra = () => {};
  assert.throws(() => validateCaseImport(executable), /only JSON/);
  const blob = backup(); blob.documents[0].blob = new Blob(['secret']);
  assert.throws(() => validateCaseImport(blob), /only JSON/);
});
