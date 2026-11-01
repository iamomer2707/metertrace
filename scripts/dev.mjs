import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve('worker/index.js');
const worker=(await import(pathToFileURL(root))).default;
const port=Number(process.env.PORT||4173);
http.createServer(async(req,res)=>{try{const origin=`http://localhost:${port}`;const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(body.length?{body,duplex:'half'}:{})});const response=await worker.fetch(request,process.env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){console.error(error.message);res.writeHead(500);res.end('Server error');}}).listen(port,'127.0.0.1',()=>console.log(`Local: http://localhost:${port}`));
