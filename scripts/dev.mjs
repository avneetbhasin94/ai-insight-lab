// Started only by the managed Sites preview daemon; uses no provider/model keys.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApplication } from '../server/application.mjs';
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8' };
const files = ['index.html','app.js','engine.js','evidence.js','real-data.js','styles.css','type.css','favicon.svg','robots.txt'];
const assets = {}; for (const file of files) assets[`/${file}`] = { body: await readFile(`dist/${file}`,'utf8'),type:types[file.slice(file.lastIndexOf('.'))],etag:'"development"' };
const app = createApplication({assets});
createServer(async (req,res) => { try { const chunks=[];for await(const chunk of req)chunks.push(chunk);const method=req.method||'GET';const request=new Request(`http://${req.headers.host}${req.url}`,{method,headers:req.headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})}); const response=await app.fetch(request,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer())); }catch{res.writeHead(500);res.end('Preview unavailable');} }).listen(Number(process.env.PORT)||4173,'0.0.0.0');
