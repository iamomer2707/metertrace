import { validateCaseImport } from './case-data.js';

const DATABASE = 'metertrace-local-v1';
const STORE = 'cases';
const ACTIVE = 'active';
const PREVIOUS = 'previous';
const SAFE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain']);
let opening;
let expectedRevision;
let unreadableSavedCase = false;
const conflict = () => new Error('This case changed in another tab. Reload before saving so those changes are not overwritten. Export your current work first if needed.');
const revision = value => Number.isSafeInteger(value?._storageRevision) && value._storageRevision >= 0 ? value._storageRevision : 0;

function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Local document storage is unavailable in this browser. Enable browser storage and try again.'));
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; expectedRevision = undefined; };
        resolve(db);
      };
      request.onerror = () => { opening = null; reject(new Error('MeterTrace could not open local storage. Your browser may be blocking it.')); };
      request.onblocked = () => { opening = null; reject(new Error('Close other MeterTrace tabs, then try again.')); };
    });
  }
  return opening;
}

function metadata(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('A saved document is malformed.');
  const { blob, ...rest } = document;
  if (blob !== undefined && (!(blob instanceof Blob) || blob.size > 20 * 1024 * 1024 || !SAFE_MIME.has(blob.type))) throw new Error('A saved original file is malformed or has an unsupported type.');
  return rest;
}
function jsonMetadata(value) {
  // Local drafts may include optional undefined properties; JSON export omits these.
  // Nonfinite numbers must not be silently converted to null by JSON.stringify.
  return JSON.parse(JSON.stringify(value, (_, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('A saved value is not finite.');
    return item;
  }));
}

/** Validate persistence before displaying it; original Blobs remain local and intact. */
export function validateStoredCase(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.documents)) throw new Error('The saved case is malformed.');
  const { trashDocuments = [], trashRecords = [], ...caseFields } = value;
  if (!Array.isArray(trashDocuments) || !Array.isArray(trashRecords) || trashDocuments.length > 200 || trashRecords.length > 10_000) throw new Error('The saved Trash is malformed.');
  const result = validateCaseImport(jsonMetadata({ ...caseFields, schemaVersion: 1, documents: value.documents.map(metadata) }));
  result.documents = result.documents.map((document, index) => ({ ...document, ...(value.documents[index].blob ? { blob: value.documents[index].blob } : {}) }));
  const documentIds = new Set(result.documents.map(document => document.id));
  const recordIds = new Set(result.documents.flatMap(document => document.records.map(record => record.id)));
  const cleanTrashDocuments = [];
  for (const entry of trashDocuments) {
    if (!entry || !Number.isInteger(entry.originalIndex) || entry.originalIndex < 0 || typeof entry.removedAt !== 'string') throw new Error('A saved Trash item is malformed.');
    const wrapper = validateCaseImport(jsonMetadata({ schemaVersion: 1, id: 'trash-validation', name: 'Trash', documents: [metadata(entry.document)] }));
    const document = wrapper.documents[0];
    if (documentIds.has(document.id)) throw new Error('A saved Trash document duplicates an existing identifier.');
    documentIds.add(document.id);
    for (const record of document.records) {
      if (recordIds.has(record.id)) throw new Error('A saved Trash record duplicates an existing identifier.');
      recordIds.add(record.id);
    }
    cleanTrashDocuments.push({ document: { ...document, ...(entry.document.blob ? { blob: entry.document.blob } : {}) }, originalIndex: entry.originalIndex, removedAt: entry.removedAt });
  }
  const knownDocuments = [...result.documents, ...cleanTrashDocuments.map(entry => entry.document)];
  const trashIds = new Set();
  const cleanTrashRecords = [];
  for (const entry of trashRecords) {
    const document = knownDocuments.find(document => document.id === entry?.documentId);
    if (!entry || typeof entry.id !== 'string' || !entry.id || trashIds.has(entry.id) || !document || !Number.isInteger(entry.originalIndex) || entry.originalIndex < 0 || typeof entry.removedAt !== 'string') throw new Error('A saved removed record is malformed.');
    const wrapper = validateCaseImport(jsonMetadata({ schemaVersion: 1, id: 'record-validation', name: 'Removed record', documents: [{ ...metadata(document), records: [entry.record] }] }));
    const record = wrapper.documents[0].records[0];
    if (recordIds.has(record.id)) throw new Error('A saved removed record duplicates an existing identifier.');
    recordIds.add(record.id); trashIds.add(entry.id);
    cleanTrashRecords.push({ id: entry.id, documentId: entry.documentId, record, originalIndex: entry.originalIndex, removedAt: entry.removedAt });
  }
  if (documentIds.size > 200) throw new Error('The saved case exceeds the document limit.');
  result.trashDocuments = cleanTrashDocuments;
  result.trashRecords = cleanTrashRecords;
  result._storageRevision = revision(value);
  return result;
}

export async function readRawSavedCase() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(ACTIVE);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(new Error('MeterTrace could not read this browser’s saved case.'));
  });
}

export async function readPreviousCase() {
  const db = await database();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(PREVIOUS);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(new Error('The previous case could not be read.'));
  });
  if (value == null) return null;
  try { return validateStoredCase(value); }
  catch { throw new Error('The previous case could not be safely opened. Its saved data has been preserved.'); }
}

export async function loadCase() {
  const value = await readRawSavedCase();
  expectedRevision = revision(value);
  if (value == null) { unreadableSavedCase = false; return null; }
  try { const result = validateStoredCase(value); unreadableSavedCase = false; return result; }
  catch { unreadableSavedCase = true; throw new Error('The saved case could not be safely opened. Its stored data has been preserved. Export a recovery copy before deliberately clearing it.'); }
}

export async function saveCase(value, { signal } = {}) {
  const abortError = () => new DOMException('Saving this case was cancelled.', 'AbortError');
  if (signal?.aborted) throw abortError();
  if (unreadableSavedCase) throw new Error('The unreadable saved case is preserved. Export a recovery copy and deliberately clear it before saving another case.');
  const safe = validateStoredCase(value);
  const db = await database();
  if (signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let failure, saved;
    const onAbort = () => { failure = abortError(); try { tx.abort(); } catch { /* Commit may have already completed. */ } };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    tx.oncomplete = () => { cleanup(); expectedRevision = saved._storageRevision; resolve(saved); };
    tx.onabort = tx.onerror = () => { cleanup(); reject(failure || new Error('Case could not be saved. Browser storage may be full. Export a backup before closing this tab.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    const current = store.get(ACTIVE);
    current.onsuccess = () => {
      if (signal?.aborted) { onAbort(); return; }
      const storedRevision = revision(current.result);
      // A tab must load before replacing an existing case. A fresh empty database is safe.
      if (expectedRevision === undefined ? current.result != null : storedRevision !== expectedRevision) { failure = conflict(); tx.abort(); return; }
      saved = { ...safe, _storageRevision: storedRevision + 1 };
      try {
        const before = current.result;
        const hasResidentWork = before && !before.demo && !before.isDemo && ((before.documents?.length || 0) + (before.trashDocuments?.length || 0) > 0 || String(before.notes || '').trim());
        // Retain one real workspace when switching cases. Opening a demo or an
        // empty case must not replace a previous resident snapshot.
        if (before?.id !== saved.id && hasResidentWork) store.put(before, PREVIOUS);
        store.put(saved, ACTIVE);
      } catch { tx.abort(); }
    };
  });
}

export async function deleteCase() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE); let failure;
    const current = store.get(ACTIVE);
    current.onsuccess = () => {
      if (expectedRevision !== undefined && revision(current.result) !== expectedRevision) { failure = conflict(); tx.abort(); return; }
      store.delete(ACTIVE);
      store.delete(PREVIOUS);
    };
    tx.oncomplete = () => { expectedRevision = 0; unreadableSavedCase = false; resolve(); };
    tx.onabort = tx.onerror = () => reject(failure || new Error('The saved case could not be deleted. Please try again.'));
  });
}
