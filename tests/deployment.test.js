import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../worker/index.js',import.meta.url),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
test('deployable worker serves versioned local assets with defensive headers',async()=>{
  const page=await worker.fetch(new Request('https://metertrace.test/'),{},{});
  assert.equal(page.status,200);const html=await page.text();
  const js=html.match(/src="(\/app\.js\?v=[a-f0-9]+)"/)[1];
  const response=await worker.fetch(new Request('https://metertrace.test'+js),{},{});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
  assert.equal(response.headers.get('cache-control'),'no-cache');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(page.headers.get('content-security-policy'),/object-src 'none'/);
});
test('worker ships a same-origin versioned PDF worker and optional AI stays disabled',async()=>{
  const pdf=await worker.fetch(new Request('https://metertrace.test/pdf.worker.min.mjs?v=6.5.438'),{},{});
  assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/javascript/);
  const health=await worker.fetch(new Request('https://metertrace.test/api/health'),{},{});
  assert.deepEqual(await health.json(),{ok:true,aiEnabled:false,tokenRequired:false});
  const unknown=await worker.fetch(new Request('https://metertrace.test/not-a-route'),{},{});
  assert.equal(unknown.status,404);
});
