import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDocuments } from '../src/demo.js';

// Minimal transactional IndexedDB test driver: mutations are staged until commit,
// and quota errors abort the entire transaction, as browser IndexedDB does.
function memoryIndexedDB(initial = []) {
  const values = new Map(initial);
  const control = { values, failNextPut: false };
  const connection = {
    objectStoreNames: { contains: () => true }, close() {},
    transaction() {
      const staged = new Map(values); let pending = 0, ended = false, scheduled = false;
      const tx = {
        abort() { if (ended) return; ended = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore() { return {
          get(key) { return request(() => staged.has(key) ? structuredClone(staged.get(key)) : undefined); },
          put(value, key) { return request(() => { if (control.failNextPut) { control.failNextPut = false; throw new Error('quota'); } staged.set(key, structuredClone(value)); return key; }); },
          delete(key) { return request(() => { staged.delete(key); }); },
        }; },
      };
      function schedule() {
        if (scheduled || ended) return; scheduled = true;
        setImmediate(() => { scheduled = false; if (pending || ended) return; ended = true; values.clear(); for (const [key,value] of staged) values.set(key,value);tx.oncomplete?.(); });
      }
      function request(operation) {
        const request = {}; pending++;
        queueMicrotask(() => {
          if (ended) return;
          try { request.result = operation(); request.onsuccess?.(); }
          catch (error) { request.error=error;request.onerror?.();tx.abort(); }
          finally { pending--;schedule(); }
        });
        return request;
      }
      schedule();return tx;
    },
  };
  control.api = { open() { const request={result:connection};queueMicrotask(()=>request.onsuccess?.());return request; } };
  return control;
}
let session=0;
const fresh = () => import(`../src/storage.js?storage-session=${++session}`);
const resident = (id='resident') => ({ id, name:'Resident review', demo:false, documents:createDemoDocuments().slice(0,1), notes:'Resident notes' });

test('transactional persistence rejects stale tabs and keeps sequential same-tab saves usable',async()=>{
  const memory=memoryIndexedDB();globalThis.indexedDB=memory.api;
  const a=await fresh(),b=await fresh();assert.equal(await a.loadCase(),null);assert.equal(await b.loadCase(),null);
  const one=resident();await a.saveCase(one);await a.saveCase({...one,notes:'second edit'});
  await assert.rejects(()=>b.saveCase({...one,notes:'stale replacement'}),/another tab/);
  assert.equal((await a.readRawSavedCase()).notes,'second edit');
  const refreshed=await b.loadCase();await b.saveCase({...refreshed,notes:'after reload'});
  await assert.rejects(()=>a.saveCase(one),/another tab/);
});

test('case switches retain one resident snapshot with Blobs and demos do not erase it',async()=>{
  const memory=memoryIndexedDB();globalThis.indexedDB=memory.api;const storage=await fresh();await storage.loadCase();
  const original=resident('original');original.documents[0].blob=new Blob(['original bytes'],{type:'text/plain'});
  await storage.saveCase(original);
  await storage.saveCase({id:'demo',name:'Sample',demo:true,documents:[]});
  const previous=await storage.readPreviousCase();assert.equal(previous.id,'original');assert.equal(await previous.documents[0].blob.text(),'original bytes');
  await storage.saveCase({id:'new-empty',name:'Fresh case',documents:[]});assert.equal((await storage.readPreviousCase()).id,'original');
  const modified=resident('new-empty');await storage.saveCase(modified);await storage.saveCase(previous);
  assert.equal((await storage.readPreviousCase()).id,'new-empty');
  await storage.deleteCase();assert.equal(await storage.readRawSavedCase(),null);assert.equal(await storage.readPreviousCase(),null);
});

test('quota failure preserves both active and previous snapshots atomically',async()=>{
  const memory=memoryIndexedDB();globalThis.indexedDB=memory.api;const storage=await fresh();await storage.loadCase();
  await storage.saveCase(resident('old'));memory.failNextPut=true;
  await assert.rejects(()=>storage.saveCase(resident('new')),/could not be saved/);
  assert.equal((await storage.readRawSavedCase()).id,'old');assert.equal(await storage.readPreviousCase(),null);
  await storage.saveCase(resident('new'));assert.equal((await storage.readRawSavedCase()).id,'new');assert.equal((await storage.readPreviousCase()).id,'old');
});

test('corrupted saved state is preserved and cannot be overwritten by a fallback demo',async()=>{
  const corrupted={id:'broken',name:'Case',documents:[null]};const memory=memoryIndexedDB([['active',corrupted]]);globalThis.indexedDB=memory.api;
  const storage=await fresh();await assert.rejects(()=>storage.loadCase(),/stored data has been preserved/);
  assert.deepEqual(await storage.readRawSavedCase(),corrupted);
  await assert.rejects(()=>storage.saveCase(resident()),/unreadable saved case is preserved/);
  assert.deepEqual(await storage.readRawSavedCase(),corrupted);
  await storage.deleteCase();await storage.saveCase(resident());assert.equal((await storage.loadCase()).id,'resident');
});

test('cancelled saves reject AbortError and preserve the current active case',async()=>{
  const memory=memoryIndexedDB();globalThis.indexedDB=memory.api;const storage=await fresh();await storage.loadCase();await storage.saveCase(resident('original'));
  const controller=new AbortController();const pending=storage.saveCase(resident('replacement'),{signal:controller.signal});controller.abort();
  await assert.rejects(()=>pending,{name:'AbortError'});assert.equal((await storage.readRawSavedCase()).id,'original');
  const already=new AbortController();already.abort();await assert.rejects(()=>storage.saveCase(resident('replacement'),{signal:already.signal}),{name:'AbortError'});
  await storage.saveCase(resident('replacement'));assert.equal((await storage.readRawSavedCase()).id,'replacement');
});
