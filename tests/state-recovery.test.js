import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_LIMITS, assertImportCapacity, findDuplicateDocument, moveDocumentToTrash, restoreDocument, moveRecordToTrash, restoreRecord, createImportOperation, reattachOriginal } from '../src/case-state.js';
import { validateStoredCase } from '../src/storage.js';
import { createDemoDocuments, demoCaseMeta } from '../src/demo.js';
const sample = () => ({ ...demoCaseMeta, demo: true, documents: createDemoDocuments() });

test('accidental document removal is reversible and preserves the original Blob and record source', () => {
  const value = sample(), original = new Blob(['original'],{type:'text/plain'});value.documents[1].blob=original;
  const removed = moveDocumentToTrash(value,value.documents[1].id);
  assert.equal(removed.documents.length,5);assert.equal(value.documents.length,6);
  assert.equal(removed.trashDocuments[0].document.blob,original);
  const restored=restoreDocument(removed,value.documents[1].id);
  assert.deepEqual(restored.documents.map(d=>d.id),value.documents.map(d=>d.id));
  assert.equal(restored.documents[1].blob,original);
  assert.deepEqual(restored.documents[1].records[0].source,value.documents[1].records[0].source);
  assert.deepEqual(restored.trashDocuments,[]);
});
test('record removal restores exact record order and requires the containing document', () => {
  const value=sample(),doc=value.documents[0],record=doc.records[0];
  const removed=moveRecordToTrash(value,doc.id,record.id);assert.equal(removed.documents[0].records.length,0);
  assert.equal(value.documents[0].records.length,1);
  const hiddenDoc=moveDocumentToTrash(removed,doc.id);
  assert.throws(()=>restoreRecord(hiddenDoc,removed.trashRecords[0].id),/containing document/);
  const restored=restoreRecord(removed,removed.trashRecords[0].id);
  assert.deepEqual(restored.documents[0].records,[record]);assert.deepEqual(restored.trashRecords,[]);
});
test('duplicate original hashes detect an active document and a document in Trash', () => {
  const value=sample();value.documents[0].sha256='same';
  assert.equal(findDuplicateDocument(value,'same').location,'active');
  const removed=moveDocumentToTrash(value,value.documents[0].id);
  assert.equal(findDuplicateDocument(removed,'same').location,'trash');
  assert.equal(findDuplicateDocument(value,''),null);assert.equal(findDuplicateDocument(value,'different'),null);
});
test('case capacity includes Trash, byte totals, text totals and batch limits', () => {
  assert.throws(()=>assertImportCapacity({documents:[]},Array(CASE_LIMITS.batchFiles+1).fill({size:1})),/20 files/);
  assert.throws(()=>assertImportCapacity({documents:Array(200).fill({})},[{}]),/200 documents/);
  const value=sample();value.documents[0].size=CASE_LIMITS.bytes;
  const removed=moveDocumentToTrash(value,value.documents[0].id);
  assert.throws(()=>assertImportCapacity(removed,[{size:1}]),/100 MB/);
  assert.throws(()=>assertImportCapacity({documents:[{pages:[{text:'x'.repeat(CASE_LIMITS.textCharacters)}]}]},[{pages:[{text:'x'}]}]),/too much extracted text/);
  assert.equal(assertImportCapacity(sample(),[{size:100}]),true);
});
test('cancelled imports and changed case identities cannot commit late results', () => {
  const operation=createImportOperation('case-a');assert.equal(operation.isCurrent('case-a'),true);
  assert.equal(operation.isCurrent('case-b'),false);assert.throws(()=>operation.assertCurrent('case-b'),{name:'AbortError'});
  operation.cancel();assert.equal(operation.signal.aborted,true);
  assert.throws(()=>operation.assertCurrent('case-a'),{name:'AbortError'});
});
test('stored-case validation retains safe Blobs and validates active and removed evidence', () => {
  const value=sample(),blob=new Blob(['original'],{type:'text/plain'});value.documents[0].blob=blob;
  const removed=moveRecordToTrash(value,value.documents[0].id,value.documents[0].records[0].id);
  const trashed=moveDocumentToTrash(removed,value.documents[0].id);
  const result=validateStoredCase(trashed);
  assert.equal(result.trashDocuments[0].document.blob,blob);assert.equal(result.trashRecords.length,1);
  assert.equal(result.documents.length,5);assert.equal(result._storageRevision,0);
});
test('corrupted saved shapes and unsafe Blob types are rejected without mutating the stored value', () => {
  const value=sample();value.documents[0].blob=new Blob(['<script>'],{type:'text/html'});
  assert.throws(()=>validateStoredCase(value),/unsupported type/);assert.equal(value.documents[0].blob.type,'text/html');
  const broken=sample();broken.documents[0].records=[null];
  assert.throws(()=>validateStoredCase(broken),/every record/);assert.equal(broken.documents[0].records[0],null);
  const duplicated=moveDocumentToTrash(sample(),'demo-bill-jan');duplicated.documents.push(duplicated.trashDocuments[0].document);
  assert.throws(()=>validateStoredCase(duplicated),/duplicates an existing identifier/);
});


test('reattaching exact original bytes preserves reviewed records, pages, IDs and notes', () => {
  const value=sample(),document=value.documents[0];document.sha256='a'.repeat(64);document.size=3;document.mime='text/plain';
  const bytes=new Blob(['abc'],{type:'text/plain'});
  const incoming={sha256:document.sha256,size:3,mime:'text/plain',blob:bytes,id:'different-id',name:'renamed.txt',pages:[],records:[]};
  const result=reattachOriginal(value,document.id,incoming);
  assert.equal(value.documents[0].blob,undefined);assert.equal(result.documents[0].blob,bytes);
  assert.equal(result.documents[0].id,document.id);assert.equal(result.documents[0].name,document.name);
  assert.equal(result.documents[0].pages,document.pages);assert.equal(result.documents[0].records,document.records);
  assert.equal(result.documents[0].records[0].confidence,'reviewed');assert.equal(result.name,value.name);
});
test('reattachment rejects mismatched hash, size, MIME and already present originals', () => {
  const value=sample(),document=value.documents[0];Object.assign(document,{sha256:'a'.repeat(64),size:3,mime:'text/plain'});
  const incoming={sha256:document.sha256,size:3,mime:'text/plain',blob:new Blob(['abc'],{type:'text/plain'})};
  assert.throws(()=>reattachOriginal(value,document.id,{...incoming,sha256:'b'.repeat(64)}),/hash does not match/);
  assert.throws(()=>reattachOriginal(value,document.id,{...incoming,size:4}),/size does not match/);
  assert.throws(()=>reattachOriginal(value,document.id,{...incoming,mime:'text/html',blob:new Blob(['abc'],{type:'text/html'})}),/type does not match/);
  assert.throws(()=>reattachOriginal(value,'missing',incoming),/no longer/);
  document.blob=incoming.blob;assert.throws(()=>reattachOriginal(value,document.id,incoming),/already has an original/);
});
