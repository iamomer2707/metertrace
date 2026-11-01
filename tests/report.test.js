import test from 'node:test';
import assert from 'node:assert/strict';
import { findingFingerprint, serializeCaseData, renderCasePacket } from '../src/report.js';
import { deriveCase } from '../src/engine.js';
import { createDemoDocuments, demoCaseMeta } from '../src/demo.js';
import { validateCaseImport } from '../src/case-data.js';

function demo() {
  const value = { ...demoCaseMeta, demo: true, createdAt: '2026-11-01T20:00:00Z', documents: createDemoDocuments(), reviewedFindings: [], excludedQuestions: [], notes: '' };
  return { value, analysis: deriveCase(value.documents) };
}

test('fingerprints are bounded and deterministic without persisting source quotations', () => {
  const { analysis } = demo();
  const finding = analysis.findings[0];
  const key = findingFingerprint(finding);
  assert.match(key, /^finding-v2:[0-9a-f]{32}$/);
  assert.equal(key, findingFingerprint(structuredClone(finding)));
  assert.equal(key.includes(finding.sources[0].quote), false);
  const reversed = { ...finding, sources: [...finding.sources].reverse() };
  assert.equal(key, findingFingerprint(reversed));
});

test('changed facts, source pages and review requirements invalidate prior review', () => {
  const { analysis } = demo();
  const finding = analysis.findings.find(finding => finding.calculation);
  const original = findingFingerprint(finding);
  for (const changed of [
    { ...finding, category: 'different' }, { ...finding, title: 'Changed title' }, { ...finding, detail: 'Changed amount' },
    { ...finding, calculation: '$10 - $3 = $7' }, { ...finding, requiresReview: !finding.requiresReview },
    { ...finding, sources: finding.sources.map((source, index) => index === 0 ? { ...source, quote: source.quote + ' changed' } : source) },
    { ...finding, sources: finding.sources.map((source, index) => index === 0 ? { ...source, page: 2 } : source) },
  ]) assert.notEqual(original, findingFingerprint(changed));
});

test('case data contains only active evidence and current review choices, never Blob or hidden recovery data', () => {
  const { value, analysis } = demo();
  const valid = findingFingerprint(analysis.findings[0]);
  const secret = 'REMOVED RESIDENT DOCUMENT SHOULD NOT LEAVE';
  value.documents[0].blob = new Blob(['active original bytes']);
  value.documents[0].unexpectedRecovery = secret;
  value.documents[0].records[0].hiddenSnapshot = secret;
  value.trashDocuments = [{ document: { name: secret, blob: new Blob([secret]) } }];
  value.trashRecords = [{ record: { source: { quote: secret } } }];
  value.recovery = { previousCase: secret };
  value.reviewedFindings = [valid, valid, 'old raw quote '+secret, 'finding-v2:stale'];
  value.excludedQuestions = [valid, 'old raw quote '+secret];
  const backup = serializeCaseData(value, analysis);
  const text = JSON.stringify(backup);
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.originalFilesIncluded, false);
  assert.equal(backup.recoveryItemsIncluded, false);
  assert.deepEqual(backup.reviewedFindings, [valid]);
  assert.deepEqual(backup.excludedQuestions, [valid]);
  assert.equal(backup.documents[0].blob, undefined);
  assert.equal(backup.trashDocuments, undefined);
  assert.equal(backup.trashRecords, undefined);
  assert.doesNotMatch(text, /REMOVED RESIDENT|active original bytes|hiddenSnapshot|unexpectedRecovery/);
  assert.equal(validateCaseImport(backup).documents.length, 6);
  assert.equal(value.trashDocuments[0].document.name, secret, 'serialization must not mutate local recovery state');
});

test('backup preserves original extracted text, manual transcripts and supported bill identity fields', () => {
  const { value, analysis } = demo();
  value.documents[0].pages[0].originalText = 'original extraction';
  value.documents[0].pages[0].text = 'manual transcript';
  value.documents[0].pages[0].manuallyTranscribed = true;
  value.documents[0].records[0].billId = 'BILL-0001';
  value.documents[0].records[0].readingMultiplier = 1;
  const copy = serializeCaseData(value, analysis);
  assert.deepEqual(copy.documents[0].pages[0], value.documents[0].pages[0]);
  assert.equal(copy.documents[0].records[0].billId, 'BILL-0001');
  assert.equal(copy.documents[0].records[0].readingMultiplier, 1);
});

test('standalone packet escapes hostile names, notes, source text and finding text', () => {
  const { value, analysis } = demo();
  const hostile = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  value.name = hostile; value.notes = hostile; value.documents[0].name = hostile;
  value.documents[0].pages[0].text = hostile;
  value.documents[0].records[0].accountId = hostile;
  analysis.findings[0].title = hostile; analysis.findings[0].detail = hostile;
  analysis.findings[0].question = hostile; analysis.findings[0].sources[0].quote = hostile;
  analysis.timeline[0].title = hostile;
  const html = renderCasePacket(value, analysis);
  assert.doesNotMatch(html, /<script|<img\s/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;alert\(1\)&quot;/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /form-action 'none'/);
});

test('every internal source link targets an included appendix page and every formula survives unchanged', () => {
  const { value, analysis } = demo();
  const html = renderCasePacket(value, analysis);
  const links = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
  const targets = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  assert.ok(links.length > 5);
  for (const link of links) assert.ok(targets.has(link), `missing source page ${link}`);
  for (const finding of analysis.findings.filter(finding => finding.calculation)) assert.ok(html.includes(finding.calculation));
  assert.match(html, /calculated separately for each reference/);
  assert.match(html, /Excess postings do not offset another reference/);
  assert.doesNotMatch(html, /\$286\.40 promised − \$120\.00 shown[^<]*= \$0/);
});

test('different credit references retain per-reference differences without a false aggregate equality', () => {
  const value = { id: 'test', name: 'Credit comparison', documents: [], reviewedFindings: [], excludedQuestions: [] };
  const analysis = { records: [], timeline: [], metrics: { creditPromised: 200, creditPosted: 150, unreconciledCredit: 100 }, findings: [
    { category: 'credits', title: 'A overposted', detail: 'A', calculation: '$150 shown − $100 promised = $50', question: 'Clarify A?', sources: [] },
    { category: 'credits', title: 'B untraced', detail: 'B', calculation: '$100 promised − $0 shown = $100 untraced', question: 'Clarify B?', sources: [] },
  ] };
  const html = renderCasePacket(value, analysis);
  assert.ok(html.includes(analysis.findings[0].calculation));
  assert.ok(html.includes(analysis.findings[1].calculation));
  assert.doesNotMatch(html, /\$200\.00\s*[−-]\s*\$150\.00\s*=\s*\$100\.00/);
});

test('manual transcripts and their prior extracted source text are both visible in print-oriented output', () => {
  const { value, analysis } = demo();
  value.documents[0].pages[0] = { pageNumber: 1, text: 'Manual corrected transcript', originalText: 'Original extraction retained', manuallyTranscribed: true };
  const html = renderCasePacket(value, analysis);
  assert.match(html, /manual transcript; compare with original file/);
  assert.match(html, /Manual corrected transcript/);
  assert.match(html, /Original extraction retained/);
  assert.match(html, /Original extracted text before manual transcription/);
  assert.match(html, /class="field-table"/);
  assert.doesNotMatch(html, /<details|display:\s*none[^}]*field-table/);
});

test('current fingerprint controls reviewed status and question inclusion; stale raw quotation keys are ignored', () => {
  const { value, analysis } = demo();
  const finding = analysis.findings[0];
  value.reviewedFindings = [findingFingerprint(finding)];
  value.excludedQuestions = [findingFingerprint(finding)];
  let html = renderCasePacket(value, analysis);
  assert.match(html, /Examined by resident/);
  const questions = html.split('<h2>4. Questions for clarification</h2>')[1].split('<h2>5.')[0];
  assert.equal(questions.includes(finding.question), false);
  const changed = structuredClone(analysis); changed.findings[0].detail += ' corrected';
  html = renderCasePacket(value, changed);
  assert.match(html, /Not yet examined by resident/);
  const changedQuestions = html.split('<h2>4. Questions for clarification</h2>')[1].split('<h2>5.')[0];
  assert.ok(changedQuestions.includes(finding.question));
});

test('packet is deterministic and broken citations produce a visible gap instead of a broken link', () => {
  const { value, analysis } = demo();
  analysis.findings[0].sources.push({ documentId: 'missing', page: 1, quote: 'missing source' });
  const html = renderCasePacket(value, analysis);
  assert.equal(html, renderCasePacket(value, analysis));
  assert.match(html, /Source page unavailable/);
  assert.doesNotMatch(html, /src--1/);
});
