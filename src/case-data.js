/** Validate an untrusted JSON backup before it replaces the current workspace. */
const MAX_TEXT = 80_000;
const MAX_DOCUMENTS = 200;
const MAX_RECORDS = 10_000;
const KINDS = new Set(['bill', 'credit', 'service']);
const NUMBER_FIELDS = ['previousReading', 'currentReading', 'usage', 'rate', 'waterCharge', 'total', 'creditApplied', 'amount', 'oldClosingReading', 'newOpeningReading', 'readingMultiplier'];
const DATE_FIELDS = ['date', 'periodStart', 'periodEnd'];
const STRING_FIELDS = ['accountId', 'accountLast4', 'meterId', 'newMeterId', 'creditReference', 'reference', 'orderId', 'action', 'status', 'extractionMethod'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function fail(message) { throw new Error(`Case data is invalid: ${message}`); }
function string(value, label, max = 256, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label} must be ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters.`);
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
function optional(value, check) { return value === undefined || value === null || check(value); }

// Clone JSON values without setters, prototypes, executable values, or object cycles.
// A bounded tree also keeps a crafted backup from exhausting the browser stack.
function jsonClone(value, state = { nodes: 0, seen: new Set() }, depth = 0) {
  if (++state.nodes > 250_000 || depth > 30) fail('the backup is too complex.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('numbers must be finite.'); return value; }
  if (!Array.isArray(value) && !object(value)) fail('only JSON objects, arrays, strings, numbers, booleans, and null are supported.');
  if (state.seen.has(value)) fail('object cycles are not supported.');
  state.seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map(item => jsonClone(item, state, depth + 1));
  else {
    const entries = [];
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('reserved object keys are not supported.');
      entries.push([key, jsonClone(item, state, depth + 1)]);
    }
    result = Object.fromEntries(entries);
  }
  state.seen.delete(value);
  return result;
}

export function validateCaseImport(data) {
  if (!object(data) || data.schemaVersion !== 1) fail('choose a MeterTrace schema version 1 JSON export.');
  const result = jsonClone(data);
  string(result.id, 'case ID');
  string(result.name, 'case name', 80);
  if (!Array.isArray(result.documents) || result.documents.length > MAX_DOCUMENTS) fail(`documents must be an array of at most ${MAX_DOCUMENTS} items.`);
  for (const field of ['demo', 'isDemo', 'originalFilesIncluded']) if (!optional(result[field], value => typeof value === 'boolean')) fail(`${field} must be a boolean.`);
  result.demo = result.demo ?? Boolean(result.isDemo);
  result.originalFilesIncluded = false;
  for (const field of ['reviewedFindings', 'excludedQuestions']) {
    if (result[field] === undefined) result[field] = [];
    if (!Array.isArray(result[field]) || result[field].length > MAX_RECORDS || result[field].some(value => typeof value !== 'string' || value.length > 100_000)) fail(`${field} must be an array of strings.`);
    result[field] = [...new Set(result[field])];
  }
  if (result.notes === undefined) result.notes = '';
  string(result.notes, 'notes', 100_000, true);
  const documentIds = new Set(), recordIds = new Set();
  let recordCount = 0;
  for (const doc of result.documents) {
    if (!object(doc)) fail('every document must be an object.');
    string(doc.id, 'document ID'); string(doc.name, 'document name', 1024);
    if (documentIds.has(doc.id)) fail('document IDs must be unique.');
    documentIds.add(doc.id);
    if (doc.type === undefined) doc.type = 'correspondence';
    string(doc.type, 'document type', 80);
    if (!Array.isArray(doc.pages) || doc.pages.length < 1 || doc.pages.length > 50) fail('every document needs 1–50 pages.');
    if (!Array.isArray(doc.records) || (recordCount += doc.records.length) > MAX_RECORDS) fail(`records must be arrays with at most ${MAX_RECORDS} records per case.`);
    for (const field of ['needsOCR', 'isDemo']) if (!optional(doc[field], value => typeof value === 'boolean')) fail(`document ${field} must be a boolean.`);
    delete doc.blob;
    const pages = new Set();
    for (const page of doc.pages) {
      if (!object(page) || !Number.isInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > 50) fail('page numbers must be integers from 1 to 50.');
      if (pages.has(page.pageNumber)) fail('page numbers must be unique within a document.');
      pages.add(page.pageNumber);
      string(page.text, 'page text', MAX_TEXT, true);
      if (page.originalText !== undefined) string(page.originalText, 'original page text', MAX_TEXT, true);
      if (!optional(page.manuallyTranscribed, value => typeof value === 'boolean')) fail('manual-transcript flags must be booleans.');
    }
    doc.pages.sort((a, b) => a.pageNumber - b.pageNumber);
    for (const record of doc.records) {
      if (!object(record) || !KINDS.has(record.kind)) fail('every record must be an object with kind bill, credit, or service.');
      string(record.id, 'record ID');
      if (recordIds.has(record.id)) fail('record IDs must be unique throughout the case.');
      recordIds.add(record.id);
      for (const field of NUMBER_FIELDS) if (!optional(record[field], value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 100)) fail(`record ${field} must be a finite number within the supported range.`);
      for (const field of DATE_FIELDS) if (!optional(record[field], date)) fail(`record ${field} must be a valid YYYY-MM-DD date.`);
      for (const field of STRING_FIELDS) if (!optional(record[field], value => typeof value === 'string' && value.length <= 2000)) fail(`record ${field} must be a string.`);
      if (record.accountLast4 != null && !/^\d{4}$/.test(record.accountLast4)) fail('account last-four identifiers must contain exactly four digits.');
      for (const field of ['unit', 'rateUnit', 'readingUnit']) if (!optional(record[field], value => ['CCF', 'gallons', ''].includes(value))) fail(`record ${field} must be CCF, gallons, or unknown.`);
      if (!optional(record.readType, value => ['actual', 'estimated', 'unknown'].includes(value))) fail('reading type must be actual, estimated, or unknown.');
      if (!optional(record.confidence, value => ['reviewed', 'needs-review'].includes(value))) fail('record confidence must be reviewed or needs-review.');
      record.confidence = record.confidence ?? 'needs-review';
      if (record.periodStart && record.periodEnd && record.periodStart > record.periodEnd) fail('billing-period end cannot precede its start.');
      if (record.source != null) {
        const source = record.source;
        if (!object(source) || source.documentId !== doc.id || !Number.isInteger(source.page) || !pages.has(source.page)) fail('record sources must reference an existing page in their own document.');
        string(source.quote, 'source excerpt', MAX_TEXT, true);
      }
    }
  }
  return result;
}
