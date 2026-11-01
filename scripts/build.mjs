import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';

await mkdir('.build',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',minify:true,outfile:'.build/app.js',target:'es2022'});
const entries = [
 ['/', 'src/index.html','text/html; charset=utf-8'],
 ['/app.js','.build/app.js','text/javascript; charset=utf-8'],
 ['/app.css','src/styles.css','text/css; charset=utf-8'],
 ['/favicon.svg','public/favicon.svg','image/svg+xml'],
 ['/licenses.txt','licenses/pdfjs-dist.txt','text/plain; charset=utf-8'],
 ['/pdf.worker.min.mjs','node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','text/javascript; charset=utf-8'],
];
const assets={};
for(const [url,path,type] of entries) assets[url]={body:await readFile(path,'utf8'),type};
for(const asset of ['/app.js','/app.css']) {
 const hash=createHash('sha256').update(assets[asset].body).digest('hex').slice(0,12);
 assets['/'].body=assets['/'].body.replace('.'+asset,'.'+asset+'?v='+hash);
}

// GitHub Pages cannot set arbitrary response headers. These supported document
// policies are delivered as early meta tags; frame-ancestors and Permissions-
// Policy are deliberately not misrepresented as HTML meta equivalents.
const documentCsp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; connect-src 'self'; base-uri 'none'; form-action 'self'";
const staticMetadata=`<meta name="metertrace-deployment" content="static">\n<meta http-equiv="Content-Security-Policy" content="${documentCsp}">\n<meta name="referrer" content="no-referrer">`;
await rm('public-site',{recursive:true,force:true});
await mkdir('public-site',{recursive:true});
for(const [url,asset] of Object.entries(assets)) {
 const filename=url==='/'?'index.html':url.slice(1);
 const body=url==='/'?asset.body.replace('<title>',staticMetadata+'\n<title>'):asset.body;
 await writeFile('public-site/'+filename,body);
}
await writeFile('public-site/.nojekyll','');

// The optional Worker deployment keeps its root routes and HTTP header controls.
assets['/'].body=assets['/'].body.replaceAll('href="./','href="/').replaceAll('src="./','src="/');
await writeFile('.build/assets.js','export const assets = '+JSON.stringify(assets)+';');
await writeFile('.build/entry.js',`import {assets} from './assets.js';\nimport {handleApi} from '../src/server.js';\nconst headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"${documentCsp}; frame-ancestors 'self'"};\nexport default {async fetch(request,env,ctx){const api=await handleApi(request,env); if(api){for(const [k,v] of Object.entries(headers))api.headers.set(k,v);return api;}if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers});const path=new URL(request.url).pathname;const asset=assets[path];if(!asset)return new Response('Not found',{status:404,headers});return new Response(request.method==='HEAD'?null:asset.body,{headers:{...headers,'content-type':asset.type,'cache-control':'no-cache'}});}};`);
await build({entryPoints:['.build/entry.js'],bundle:true,format:'esm',minify:true,outfile:'worker/index.js',target:'es2022',platform:'browser'});
console.log('Built public-site/ for GitHub Pages and the optional Worker application.');
