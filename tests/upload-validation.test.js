import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFile, MAX_FILE_BYTES } from '../src/documents.js';
const file = (contents,name='bill.txt',type='text/plain') => new File([contents],name,{type});

test('local text import hashes bytes, preserves numbered pages, and forces safe original MIME', async()=>{
  const source=file('Water bill\nAccount number: 12345678\fCredit notice\nApproved credit: $10','bill.txt');
  const result=await extractFile(source);
  assert.equal(result.pages.length,2);assert.equal(result.pages[1].pageNumber,2);
  assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(result.blob.type,'text/plain');
  assert.equal(await result.blob.text(),await source.text());
  assert.equal((await extractFile(file(await source.text(),'renamed.md','text/markdown'))).sha256,result.sha256);
});
test('empty, unsupported, oversized and binary disguised as text are rejected',async()=>{
  await assert.rejects(()=>extractFile(file('')),/empty/);
  await assert.rejects(()=>extractFile(file('<svg/>','image.svg','image/svg+xml')),/choose PDF/);
  await assert.rejects(()=>extractFile(file('x'.repeat(MAX_FILE_BYTES+1))),/20 MB/);
  await assert.rejects(()=>extractFile(file(new Uint8Array([0,1,2,255]))),/encoding|binary/);
  await assert.rejects(()=>extractFile(file('%PDF-1.4\n','renamed.txt')),/contents do not match/);
});
test('renamed HTML cannot pass as a PDF or image and conflicting declarations are rejected',async()=>{
  for(const [name,type]of[['bill.pdf','application/pdf'],['notice.png','image/png'],['notice.jpg','image/jpeg']])await assert.rejects(()=>extractFile(file('<html><script>alert(1)</script></html>',name,type)),/contents do not match/);
  await assert.rejects(()=>extractFile(file('plain','bill.txt','application/pdf')),/type and filename disagree/);
});
test('text page and case-backup compatible size limits reject excessive imports',async()=>{
  await assert.rejects(()=>extractFile(file('x'.repeat(80001))),/80,000/);
  await assert.rejects(()=>extractFile(file(Array(51).fill('page').join('\f'))),/50 pages/);
});
test('UTF-16 BOM text is decoded without inventing binary pages',async()=>{
  const result=await extractFile(file(new Uint8Array([255,254,65,0,10,0,66,0])));
  assert.equal(result.pages[0].text,'A\nB');
});
test('an aborted extraction stops before access and while file reading is pending',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>extractFile(file('text'),{signal:controller.signal}),{name:'AbortError'});
  const later=new AbortController();const never={name:'bill.txt',type:'text/plain',size:4,arrayBuffer:()=>new Promise(()=>{})};
  const pending=extractFile(never,{signal:later.signal});later.abort();await assert.rejects(()=>pending,{name:'AbortError'});
});

test('image header dimensions reject pixel bombs before browser decoding',async()=>{
  const bytes=new Uint8Array(32);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,100000);view.setUint32(20,100000);
  await assert.rejects(()=>extractFile(file(bytes,'scan.png','image/png')),/25 megapixels/);
});
test('signed images must pass a browser decoder and decoded dimensions must agree',async()=>{
  const bytes=new Uint8Array(32);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,1);view.setUint32(20,1);
  const previous=globalThis.createImageBitmap;
  try {
    globalThis.createImageBitmap=async()=>{throw new Error('corrupt stream');};
    await assert.rejects(()=>extractFile(file(bytes,'scan.png','image/png')),/damaged/);
    globalThis.createImageBitmap=async()=>({width:2,height:2,close(){}});
    await assert.rejects(()=>extractFile(file(bytes,'scan.png','image/png')),/dimensions could not be verified/);
    let closed=false;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){closed=true;}});
    const result=await extractFile(file(bytes,'scan.png','image/png'));assert.equal(result.needsOCR,true);assert.equal(result.pages[0].text,'');assert.equal(closed,true);
  } finally { globalThis.createImageBitmap=previous; }
});
