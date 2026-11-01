import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';

const directory=new URL('../public-site/',import.meta.url);
const html=await readFile(new URL('index.html',directory),'utf8');
const deployedPage=new URL('https://iamomer2707.github.io/metertrace/');

test('Pages artifacts resolve scripts, styles and icon inside the repository subpath',async()=>{
 const matches=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match=>match[1]);
 assert.equal(matches.length,3);
 for(const resource of matches){
  assert.ok(resource.startsWith('./'),`${resource} must not escape the repository base path`);
  const resolved=new URL(resource,deployedPage);
  assert.equal(resolved.origin,deployedPage.origin);
  assert.ok(resolved.pathname.startsWith('/metertrace/'));
  const local=new URL(resolved.pathname.slice('/metertrace/'.length),directory);
  assert.ok((await stat(local)).size>0);
 }
 assert.match(html,/src="\.\/app\.js\?v=[a-f0-9]{12}"/);
 assert.match(html,/href="\.\/app\.css\?v=[a-f0-9]{12}"/);
 assert.doesNotMatch(html,/<base\b/i);
});

test('Pages output explicitly uses static mode and supported early document policies',()=>{
 assert.match(html,/<meta name="metertrace-deployment" content="static">/);
 const policy=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 assert.match(policy,/script-src 'self'/);
 assert.match(policy,/object-src 'none'/);
 assert.match(policy,/base-uri 'none'/);
 assert.doesNotMatch(policy,/frame-ancestors|Permissions-Policy/);
 assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script'));
 assert.match(html,/<meta name="referrer" content="no-referrer">/);
 assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('Pages output includes a local PDF worker compatible with module-relative resolution',async()=>{
 const workerUrl=new URL('./pdf.worker.min.mjs?v=6.5.438',new URL('app.js?v=hash',deployedPage));
 assert.equal(workerUrl.pathname,'/metertrace/pdf.worker.min.mjs');
 const worker=await readFile(new URL('pdf.worker.min.mjs',directory),'utf8');
 assert.ok(worker.length>100_000);
 assert.match(worker,/WorkerMessageHandler/);
 assert.equal((await stat(new URL('.nojekyll',directory))).isFile(),true);
 const license=await readFile(new URL('licenses.txt',directory),'utf8');
 assert.match(license,/Apache License/);
});

test('Worker HTML remains API-capable without static-only metadata',async()=>{
 const source=await readFile(new URL('../worker/index.js',import.meta.url),'utf8');
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
 const response=await worker.fetch(new Request('https://metertrace.test/'),{},{});
 const body=await response.text();
 assert.doesNotMatch(body,/name="metertrace-deployment"/);
 assert.match(body,/src="\/app\.js\?v=/);
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
});
