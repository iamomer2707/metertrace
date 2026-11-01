import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCase, extractRecords } from '../src/engine.js';
import { createDemoDocuments } from '../src/demo.js';

function fixture(records) {
  return records.map((record, index) => ({ id: `doc-${index}`, name: `Evidence ${index}`, pages: [{ pageNumber: 1, text: `Source excerpt ${index}` }], records: [{ accountId: '00004821', accountLast4: '4821', ...record, source: record.source || { documentId: `doc-${index}`, page: 1, quote: `Source excerpt ${index}` } }] }));
}
const promise = { kind: 'credit', status: 'promised', reference: 'CR-1', amount: 286.4, date: '2026-05-20' };
const bill = { kind: 'bill', date: '2026-07-05', periodStart: '2026-05-01', periodEnd: '2026-06-30', readType: 'actual', creditReference: 'CR-1', creditApplied: 120 };

test('fictional case reconciles credit in integer cents with all findings source-linked', () => {
  const result = deriveCase(createDemoDocuments());
  assert.equal(result.metrics.documentCount, 6);
  assert.equal(result.metrics.periodCount, 3);
  assert.equal(result.metrics.estimatedCount, 2);
  assert.equal(result.metrics.actualCount, 1);
  assert.equal(result.metrics.unreconciledCredit, 166.4);
  assert.equal(result.metrics.creditPromised, 286.4);
  assert.equal(result.metrics.creditPosted, 120);
  assert.ok(result.findings.find(f => f.calculation === '$286.40 promised − $120.00 shown = $166.40 untraced'));
  assert.ok(result.findings.every(f => f.sources.length > 0));
  assert.ok(result.findings.some(f => f.category === 'service'));
  assert.ok(result.findings.some(f => f.category === 'meter'));
  assert.ok(result.findings.some(f => f.category === 'estimates'));
});

test('does not reconcile credits across different full accounts or last4 accounts', () => {
  const result = deriveCase(fixture([promise, { ...bill, accountId: '99994821' }]));
  assert.equal(result.metrics.creditPosted, 0);
  assert.equal(result.metrics.unreconciledCredit, 286.4);
});

test('requires explicit adjustment reference instead of matching currency alone', () => {
  const result = deriveCase(fixture([promise, { ...bill, creditReference: undefined }]));
  assert.equal(result.metrics.creditPosted, 0);
  assert.equal(result.metrics.unreconciledCredit, 286.4);
});

test('does not invent a reference for a credit notice', () => {
  const result = deriveCase(fixture([{ ...promise, reference: undefined }, bill]));
  assert.equal(result.metrics.creditPromised, 0);
  assert.equal(result.metrics.unreconciledCredit, 0);
  assert.ok(result.findings.some(f => f.title === 'Credit cannot be matched to a bill'));
});

test('duplicate credit approval letters count one promise', () => {
  const result = deriveCase(fixture([promise, { ...promise }, bill]));
  assert.equal(result.metrics.unreconciledCredit, 166.4);
  assert.equal(result.metrics.creditPromised, 286.4);
});

test('posting correspondence is not counted again as a posted bill credit', () => {
  const result = deriveCase(fixture([promise, { ...promise, status: 'posted', amount: 120 }, bill]));
  assert.equal(result.metrics.creditPosted, 120);
  assert.equal(result.metrics.unreconciledCredit, 166.4);
});

test('duplicate copies of a bill count their credit once', () => {
  const result = deriveCase(fixture([promise, bill, { ...bill }]));
  assert.equal(result.metrics.creditPosted, 120);
  assert.equal(result.metrics.periodCount, 1);
  assert.ok(result.findings.some(f => f.title === 'Repeated billing records excluded'));
});

test('contradictory promise amounts are not arbitrarily reconciled', () => {
  const result = deriveCase(fixture([promise, { ...promise, amount: 300 }, bill]));
  assert.equal(result.metrics.creditPromised, 0);
  assert.ok(result.findings.some(f => f.title === 'Credit notices contradict one another'));
});

test('mixed usage units are not summed and rate arithmetic requires matching basis', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'actual', usage: 10, unit: 'CCF', rate: 1, rateUnit: 'gallons', waterCharge: 999 }, { kind: 'bill', readType: 'actual', usage: 10, unit: 'gallons' }]));
  assert.equal(result.metrics.usageTotal, null);
  assert.equal(result.metrics.usageUnit, null);
  assert.equal(result.findings.filter(f => f.category === 'calculation').length, 0);
});

test('arithmetic computes only water charge, never total due', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'actual', usage: 20, unit: 'CCF', rate: 4.56, rateUnit: 'CCF', waterCharge: 91.2, total: 500 }]));
  assert.equal(result.findings.filter(f => f.category === 'calculation').length, 0);
  const mismatch = deriveCase(fixture([{ kind: 'bill', readType: 'actual', usage: 20, unit: 'CCF', rate: 4.56, rateUnit: 'CCF', waterCharge: 100 }]));
  assert.match(mismatch.findings[0].calculation, /\$91\.20/);
});

test('missing or fabricated page citations exclude records from calculations', () => {
  const documents = fixture([promise, bill]);
  documents[1].records[0].source.quote = 'Not present on source page';
  const result = deriveCase(documents);
  assert.equal(result.metrics.creditPosted, 0);
  assert.equal(result.metrics.sourcedRecordCount, 1);
  assert.ok(result.findings.some(f => f.title === 'Source pages need attention'));
});

test('meter replacement prevents subtraction across a meter boundary', () => {
  const result = deriveCase(fixture([{ ...bill, previousReading: 1200, currentReading: 10, usage: 10, unit: 'CCF', readingUnit: 'CCF', meterId: 'NEW' }, { kind: 'service', date: '2026-05-12', meterId: 'OLD', newMeterId: 'NEW', orderId: 'SO-1', action: 'Meter replacement' }]));
  assert.ok(!result.findings.some(f => f.title === 'Reading decreases within a bill'));
  assert.ok(result.findings.some(f => f.title === 'Meter replacement readings are missing'));
});

test('labeled extraction supports currency, dates, account and credit reference', () => {
  const text = 'Account number: 00004821\nBill date: 7/5/2026\nBilling period: 05/01/2026 to 06/30/2026\nReading type: Actual\nUsage: 1,234\nUnit: CCF\nWater charge: $5,627.04\nTotal due: $9,999.99\nCredit applied: $120.00\nCredit reference: CR-1';
  const records = extractRecords([{ pageNumber: 2, text }], 'uploaded');
  assert.equal(records.length, 1);
  assert.equal(records[0].date, '2026-07-05');
  assert.equal(records[0].periodStart, '2026-05-01');
  assert.equal(records[0].waterCharge, 5627.04);
  assert.equal(records[0].usage, 1234);
  assert.equal(records[0].accountId, '00004821');
  assert.equal(records[0].creditReference, 'CR-1');
  assert.equal(records[0].confidence, 'needs-review');
  assert.equal(records[0].source.page, 2);
});

test('unrecognized text returns no invented records; missing amounts remain absent', () => {
  assert.deepEqual(extractRecords([{ pageNumber: 1, text: 'Thank you for your message.' }], 'id'), []);
  const records = extractRecords([{ pageNumber: 1, text: 'Billing period: 2026-01-01 to 2026-02-28\nReading type: Estimated' }], 'id');
  assert.equal(records[0].waterCharge, undefined);
  assert.equal(records[0].creditApplied, undefined);
  assert.equal(records[0].date, undefined);
});

test('labeled extraction rejects impossible calendar dates', () => {
  const records = extractRecords([{ pageNumber: 1, text: 'Bill date: 2026-02-31\nBilling period: 02/31/2026 to 03/30/2026' }], 'id');
  assert.equal(records[0].date, undefined);
  assert.equal(records[0].periodStart, undefined);
  assert.equal(records[0].periodEnd, '2026-03-30');
});

test('estimated periods with a gap are not described as consecutive', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'estimated', periodStart: '2026-01-01', periodEnd: '2026-01-31' }, { kind: 'bill', readType: 'estimated', periodStart: '2026-04-01', periodEnd: '2026-04-30' }]));
  assert.ok(!result.findings.some(f => f.category === 'estimates'));
  assert.ok(result.findings.some(f => f.title === 'A billing period may be missing'));
});

test('shared period boundary remains a possible consecutive estimate', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'estimated', periodStart: '2026-01-01', periodEnd: '2026-03-01' }, { kind: 'bill', readType: 'estimated', periodStart: '2026-03-01', periodEnd: '2026-05-01' }]));
  assert.ok(result.findings.some(f => f.category === 'estimates'));
  assert.ok(!result.findings.some(f => f.title === 'A billing period may be missing'));
});

test('reading subtraction requires an explicitly matching reading unit', () => {
  const readingBill = { kind: 'bill', readType: 'actual', previousReading: 100, currentReading: 120, usage: 200, unit: 'CCF' };
  const absent = deriveCase(fixture([readingBill]));
  const unlike = deriveCase(fixture([{ ...readingBill, readingUnit: 'gallons' }]));
  const explicit = deriveCase(fixture([{ ...readingBill, readingUnit: 'CCF' }]));
  assert.ok(!absent.findings.some(f => f.title === 'Usage does not match meter readings'));
  assert.ok(!unlike.findings.some(f => f.title === 'Usage does not match meter readings'));
  assert.ok(explicit.findings.some(f => f.title === 'Usage does not match meter readings'));
});

test('extractor never infers reading units from usage units', () => {
  const text = 'Billing period: 2026-01-01 to 2026-02-28\nUnit: CCF\nPrevious reading: 100\nCurrent reading: 120\nUsage: 20';
  assert.equal(extractRecords([{ pageNumber: 1, text }], 'id')[0].readingUnit, undefined);
  assert.equal(extractRecords([{ pageNumber: 1, text: text + '\nReading unit: CCF' }], 'id')[0].readingUnit, 'CCF');
});

test('usage totals do not combine different or unidentified accounts', () => {
  const record = { kind: 'bill', readType: 'actual', usage: 10, unit: 'CCF' };
  const different = deriveCase(fixture([record, { ...record, accountId: '99994821' }]));
  const unidentified = deriveCase(fixture([record, { ...record, accountId: undefined, accountLast4: undefined }]));
  assert.equal(different.metrics.usageTotal, null);
  assert.equal(unidentified.metrics.usageTotal, null);
});

test('partial and masked account identifiers never reconcile financial records', () => {
  for (const partial of [{ accountId: undefined, accountLast4: '4821' }, { accountId: 'XXXX4821' }, { accountId: '4821' }]) {
    const result = deriveCase(fixture([{ ...promise, ...partial }, { ...bill, ...partial }]));
    assert.equal(result.metrics.creditPromised, 0);
    assert.equal(result.metrics.creditPosted, 0);
    assert.equal(result.metrics.unreconciledCredit, 0);
    assert.ok(result.findings.some(f => f.title === 'Confirm the complete account identity'));
  }
});

test('formatting spaces and hyphens do not change a complete account identity', () => {
  const result = deriveCase(fixture([{ ...promise, accountId: '0000-4821' }, { ...bill, accountId: '0000 4821' }]));
  assert.equal(result.metrics.creditPosted, 120);
  assert.equal(result.metrics.unreconciledCredit, 166.4);
});

test('one-cent credit and water charge differences are visible', () => {
  const result = deriveCase(fixture([{ ...promise, amount: 120.01 }, bill]));
  assert.equal(result.metrics.unreconciledCredit, .01);
  const charge = deriveCase(fixture([{ kind: 'bill', readType: 'actual', usage: 10, unit: 'CCF', rate: 1, rateUnit: 'CCF', waterCharge: 10.01 }]));
  assert.ok(charge.findings.some(f => f.title === 'Water charge needs an explanation'));
});

test('negative, fractional-cent, unsafe and impossible-date records cannot affect totals', () => {
  for (const badBill of [{ ...bill, creditApplied: -20 }, { ...bill, creditApplied: .001 }, { ...bill, creditApplied: Number.MAX_VALUE }, { ...bill, date: '2026-02-31' }, { ...bill, periodStart: '2027-01-01' }]) {
    const result = deriveCase(fixture([promise, badBill]));
    assert.equal(result.metrics.creditPosted, 0);
    assert.equal(result.metrics.invalidRecordCount, 1);
    assert.ok(result.findings.some(f => f.title === 'Invalid field values need review'));
  }
});

test('a carried-forward credit reference on multiple bills is not summed as new postings', () => {
  const result = deriveCase(fixture([promise, bill, { ...bill, date: '2026-09-05', periodStart: '2026-07-01', periodEnd: '2026-08-31' }]));
  assert.equal(result.metrics.creditPosted, 0);
  assert.equal(result.metrics.creditPromised, 0);
  assert.equal(result.metrics.creditNeedsReviewCount, 1);
  assert.ok(result.findings.some(f => f.title === 'Credit posting history needs a ledger'));
});

test('a credit statement predating its promise cannot silently satisfy that promise', () => {
  const result = deriveCase(fixture([promise, { ...bill, date: '2026-04-05' }]));
  assert.equal(result.metrics.creditPosted, 0);
  assert.equal(result.metrics.creditNeedsReviewCount, 1);
  assert.ok(result.findings.some(f => f.title === 'Credit posting history needs a ledger'));
});

test('an undated credit notice needs chronology before numeric reconciliation', () => {
  const result = deriveCase(fixture([{ ...promise, date: undefined }, bill]));
  assert.equal(result.metrics.creditPromised, 0);
  assert.equal(result.metrics.creditNeedsReviewCount, 1);
});

test('different readings on otherwise matching bills remain contradictory evidence', () => {
  const result = deriveCase(fixture([promise, { ...bill, previousReading: 100, currentReading: 120 }, { ...bill, previousReading: 100, currentReading: 140 }]));
  assert.equal(result.metrics.conflictingBillCount, 2);
  assert.equal(result.metrics.periodCount, 0);
  assert.equal(result.metrics.creditPosted, 0);
  assert.ok(result.findings.some(f => f.title === 'Billing records disagree for the same period'));
  assert.ok(!result.findings.some(f => f.title === 'Repeated billing records excluded'));
});

test('record ID collisions never redirect the other record citation', () => {
  const docs = fixture([{ ...promise, id: 'collision' }, { ...bill, id: 'collision' }]);
  docs[1].records[0].source.quote = 'not found';
  const result = deriveCase(docs);
  assert.equal(result.metrics.sourcedRecordCount, 1);
  assert.equal(result.metrics.creditPosted, 0);
});

test('a record cannot borrow a quote from another document', () => {
  const docs = fixture([promise, bill]);
  docs[1].records[0].source = { ...docs[0].records[0].source };
  const result = deriveCase(docs);
  assert.equal(result.metrics.sourcedRecordCount, 1);
});

test('unsafe rate products do not produce Infinity or imprecise money findings', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'actual', usage: 100000000, unit: 'CCF', rate: 100000000, rateUnit: 'CCF', waterCharge: 1 }]));
  assert.ok(result.findings.some(f => f.title === 'Charge calculation exceeds supported precision'));
  assert.ok(!JSON.stringify(result).includes('Infinity'));
});

test('malformed labelled numbers stay unknown rather than being partially parsed', () => {
  for (const value of ['$1,2', '12oops', '$10.1.2', '-12', '$12 credit']) {
    const result = extractRecords([{ pageNumber: 1, text: `Water charge: ${value}\nTotal due: $30.00` }], 'doc');
    assert.equal(result[0].waterCharge, undefined);
  }
});

test('multiple statements or accounts on one page require manual extraction', () => {
  for (const text of ['Account number: 00004821\nAccount number: 99994821\nTotal due: $30', 'Billing period: 2026-01-01 to 2026-02-28\nBilling period: 2026-03-01 to 2026-04-30\nTotal due: $30']) {
    assert.deepEqual(extractRecords([{ pageNumber: 1, text }], 'doc'), []);
  }
});

test('pending credit status is not promoted to an approved promise', () => {
  const [record] = extractRecords([{ pageNumber: 1, text: 'Credit amount: $120\nCredit status: Pending' }], 'doc');
  assert.equal(record.status, undefined);
  const result = deriveCase(fixture([{ ...record, source: undefined }]));
  assert.equal(result.metrics.creditPromised, 0);
  assert.ok(result.findings.some(f => f.title === 'Credit status is not documented'));
});

test('old and new meter boundary readings are extracted when explicitly labelled', () => {
  const [record] = extractRecords([{ pageNumber: 1, text: 'Service order: SO-1\nOld meter closing reading: 1234\nNew meter opening reading: 0' }], 'doc');
  assert.equal(record.oldClosingReading, 1234);
  assert.equal(record.newOpeningReading, 0);
});

test('undocumented estimated endpoints do not establish a consecutive sequence', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'estimated', periodEnd: '2026-01-31' }, { kind: 'bill', readType: 'estimated', periodStart: '2026-02-01', periodEnd: '2026-02-28' }]));
  assert.ok(!result.findings.some(f => f.category === 'estimates'));
});

test('many nearby service notices produce one bounded evidence thread', () => {
  const result = deriveCase(fixture(Array.from({ length: 100 }, (_, i) => ({ kind: 'service', date: '2026-05-20', meterId: 'M-1', action: 'Meter replacement', orderId: `SO-${i}` }))));
  assert.equal(result.findings.filter(f => f.category === 'service').length, 1);
});

test('invalid matched postings do not become an assumed zero posting', () => {
  const result = deriveCase(fixture([promise, { ...bill, creditApplied: -120 }]));
  assert.equal(result.metrics.creditPromised, 0);
  assert.equal(result.metrics.unreconciledCredit, 0);
  assert.equal(result.metrics.creditNeedsReviewCount, 1);
});

test('overlapping periods do not create a combined usage total', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'actual', periodStart: '2026-01-01', periodEnd: '2026-03-01', usage: 20, unit: 'CCF' }, { kind: 'bill', readType: 'actual', periodStart: '2026-02-01', periodEnd: '2026-04-01', usage: 30, unit: 'CCF' }]));
  assert.equal(result.metrics.usageTotal, null);
  assert.ok(result.findings.some(f => f.title === 'Billing periods overlap'));
});

test('missing usage is unknown and cannot be added as zero to a case total', () => {
  const result = deriveCase(fixture([{ kind: 'bill', readType: 'actual', usage: 20, unit: 'CCF' }, { kind: 'bill', readType: 'actual', unit: 'CCF' }]));
  assert.equal(result.metrics.usageTotal, null);
});

test('reference matching ignores accidental surrounding whitespace only', () => {
  const result = deriveCase(fixture([{ ...promise, reference: ' CR-1 ' }, bill]));
  assert.equal(result.metrics.unreconciledCredit, 166.4);
});

test('multiple credit lines on one statement require manual separation', () => {
  const records = extractRecords([{ pageNumber: 1, text: 'Billing period: 2026-01-01 to 2026-02-28\nCredit reference: CR-1\nCredit applied: $120\nCredit reference: CR-2\nCredit applied: $50' }], 'doc');
  assert.deepEqual(records, []);
});

test('explicit reading multipliers are applied and shown in mismatch formulas', () => {
  const scaledBill = { kind: 'bill', readType: 'actual', previousReading: 100, currentReading: 120, usage: 200, unit: 'CCF', readingUnit: 'CCF', readingMultiplier: 10 };
  const equal = deriveCase(fixture([scaledBill]));
  assert.ok(!equal.findings.some(f => f.title === 'Usage does not match meter readings'));
  const mismatch = deriveCase(fixture([{ ...scaledBill, usage: 201 }]));
  assert.ok(mismatch.findings.some(f => f.calculation === '(120 − 100) × 10 = 200 CCF; bill shows 201 CCF'));
});

test('nonpositive or unsafe reading multipliers are excluded from arithmetic', () => {
  for (const readingMultiplier of [0, -1, Number.MAX_VALUE]) {
    const result = deriveCase(fixture([{ kind: 'bill', readType: 'actual', previousReading: 100, currentReading: 120, usage: 200, unit: 'CCF', readingUnit: 'CCF', readingMultiplier }]));
    assert.equal(result.metrics.invalidRecordCount, 1);
    assert.ok(!result.findings.some(f => f.title === 'Usage does not match meter readings'));
  }
  const overflow = deriveCase(fixture([{ kind: 'bill', readType: 'actual', previousReading: 0, currentReading: 100000000, usage: 200, unit: 'CCF', readingUnit: 'CCF', readingMultiplier: 100000000 }]));
  assert.ok(overflow.findings.some(f => f.title === 'Reading calculation exceeds supported precision'));
});

test('a reading multiplier is extracted only from its explicit label', () => {
  const text = 'Billing period: 2026-01-01 to 2026-02-28\nUsage: 200\nUnit: CCF';
  assert.equal(extractRecords([{ pageNumber: 1, text }], 'doc')[0].readingMultiplier, undefined);
  assert.equal(extractRecords([{ pageNumber: 1, text: text + '\nReading multiplier: 10' }], 'doc')[0].readingMultiplier, 10);
});

test('multiplier contradictions are not erased as duplicate statements', () => {
  const common = { ...bill, previousReading: 100, currentReading: 120, readingUnit: 'CCF', unit: 'CCF', usage: 200 };
  const result = deriveCase(fixture([{ ...common, readingMultiplier: 1 }, { ...common, readingMultiplier: 10 }]));
  assert.equal(result.metrics.conflictingBillCount, 2);
  assert.ok(!result.findings.some(f => f.title === 'Repeated billing records excluded'));
});

test('an invalid multiplier label never silently becomes the default factor', () => {
  for (const value of ['0', '-10', 'ten', '10oops']) {
    assert.deepEqual(extractRecords([{ pageNumber: 1, text: `Total due: $100\nReading multiplier: ${value}` }], 'doc'), []);
  }
});
