/** Reversible local-case operations. Trash is never part of active reconciliation. */
export const CASE_LIMITS = Object.freeze({ batchFiles: 20, documents: 200, bytes: 100 * 1024 * 1024, textCharacters: 8_000_000 });
const activeDocuments = value => Array.isArray(value?.documents) ? value.documents : [];
const documentTrash = value => Array.isArray(value?.trashDocuments) ? value.trashDocuments : [];
const recordTrash = value => Array.isArray(value?.trashRecords) ? value.trashRecords : [];
const allDocuments = value => [...activeDocuments(value), ...documentTrash(value).map(entry => entry.document)];
const sizeOf = document => Math.max(Number.isFinite(document?.size) ? Math.max(0, document.size) : 0, document?.blob instanceof Blob ? document.blob.size : 0);
const textSize = document => (document?.pages || []).reduce((sum, page) => sum + (page.text?.length || 0) + (page.originalText?.length || 0), 0);

export function assertImportCapacity(value, additions = []) {
  if (!Array.isArray(additions)) throw new Error('Choose document files to import.');
  if (additions.length > CASE_LIMITS.batchFiles) throw new Error(`Import up to ${CASE_LIMITS.batchFiles} files at a time.`);
  const existing = allDocuments(value);
  if (existing.length + additions.length > CASE_LIMITS.documents) throw new Error(`A case can hold ${CASE_LIMITS.documents} documents including Trash. Restore or permanently delete unneeded Trash items before adding more.`);
  if ([...existing, ...additions].reduce((sum, document) => sum + sizeOf(document), 0) > CASE_LIMITS.bytes) throw new Error('This case would exceed 100 MB including Trash. Export a backup and remove unneeded files before importing.');
  if ([...existing, ...additions].reduce((sum, document) => sum + textSize(document), 0) > CASE_LIMITS.textCharacters) throw new Error('This case contains too much extracted text. Split it into separate cases before adding more documents.');
  return true;
}

export function findDuplicateDocument(value, sha256) {
  if (typeof sha256 !== 'string' || !sha256) return null;
  const document = activeDocuments(value).find(document => document.sha256 === sha256);
  if (document) return { document, location: 'active' };
  const removed = documentTrash(value).find(entry => entry.document.sha256 === sha256);
  return removed ? { document: removed.document, location: 'trash' } : null;
}

export function moveDocumentToTrash(value, documentId) {
  const index = activeDocuments(value).findIndex(document => document.id === documentId);
  if (index < 0) throw new Error('That document is no longer in the active case.');
  const document = value.documents[index];
  return { ...value, documents: value.documents.filter(item => item.id !== documentId), trashDocuments: [...documentTrash(value), { document, originalIndex: index, removedAt: new Date().toISOString() }] };
}

export function restoreDocument(value, documentId) {
  const entry = documentTrash(value).find(entry => entry.document.id === documentId);
  if (!entry) throw new Error('That document is no longer in Trash.');
  if (activeDocuments(value).some(document => document.id === documentId)) throw new Error('A document with this identifier is already active.');
  const documents = [...activeDocuments(value)];
  documents.splice(Math.min(Math.max(0, entry.originalIndex), documents.length), 0, entry.document);
  return { ...value, documents, trashDocuments: documentTrash(value).filter(item => item !== entry) };
}

export function moveRecordToTrash(value, documentId, recordId) {
  const document = activeDocuments(value).find(document => document.id === documentId);
  const index = document?.records?.findIndex(record => record.id === recordId) ?? -1;
  if (index < 0) throw new Error('That record is no longer in the active document.');
  const record = document.records[index];
  return { ...value, documents: value.documents.map(item => item.id === documentId ? { ...item, records: item.records.filter(record => record.id !== recordId) } : item), trashRecords: [...recordTrash(value), { id: crypto.randomUUID(), documentId, record, originalIndex: index, removedAt: new Date().toISOString() }] };
}

export function restoreRecord(value, trashId) {
  const entry = recordTrash(value).find(item => item.id === trashId);
  if (!entry) throw new Error('That record is no longer in Trash.');
  const document = activeDocuments(value).find(document => document.id === entry.documentId);
  if (!document) throw new Error('Restore the containing document before restoring this record.');
  if (document.records.some(record => record.id === entry.record.id)) throw new Error('A record with this identifier is already active.');
  const records = [...document.records];
  records.splice(Math.min(Math.max(0, entry.originalIndex), records.length), 0, entry.record);
  return { ...value, documents: value.documents.map(item => item.id === entry.documentId ? { ...item, records } : item), trashRecords: recordTrash(value).filter(item => item.id !== trashId) };
}

/** A cancelled import can finish parsing, but it can never commit to a later case. */
export function createImportOperation(caseId) {
  const controller = new AbortController();
  const operation = {
    id: crypto.randomUUID(), caseId, signal: controller.signal,
    cancel() { controller.abort(); },
    isCurrent(currentCaseId) { return !controller.signal.aborted && currentCaseId === caseId; },
    assertCurrent(currentCaseId) {
      if (!operation.isCurrent(currentCaseId)) throw new DOMException('Import cancelled. No pending files were added to another case.', 'AbortError');
    },
  };
  return operation;
}

/** Reattach only verified original bytes to an active backup-restored document. */
export function reattachOriginal(value, documentId, extractedDocument) {
  const document = activeDocuments(value).find(item => item.id === documentId);
  if (!document) throw new Error('That document is no longer in the active case.');
  if (document.blob) throw new Error('That document already has an original file.');
  const supportedMime = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain']);
  if (!/^[a-f0-9]{64}$/.test(document.sha256 || '') || extractedDocument?.sha256 !== document.sha256) throw new Error('The original file hash does not match this saved document.');
  if (!(extractedDocument.blob instanceof Blob) || !Number.isSafeInteger(extractedDocument.size) || extractedDocument.size < 1 || extractedDocument.size !== extractedDocument.blob.size || document.size !== extractedDocument.size) throw new Error('The original file size does not match this saved document.');
  if (!supportedMime.has(extractedDocument.mime) || document.mime !== extractedDocument.mime || extractedDocument.blob.type !== extractedDocument.mime) throw new Error('The original file type does not match this saved document.');
  return { ...value, documents: value.documents.map(item => item.id === documentId ? { ...item, blob: extractedDocument.blob, mime: extractedDocument.mime, size: extractedDocument.size } : item) };
}
