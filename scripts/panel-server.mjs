import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {canonicalPanelPath} from '../packages/ui/portal-routes.mjs';
const kind=process.argv[2];
if(!['owner','admin'].includes(kind))throw Error('Unknown panel');
const apiPort=Number(process.argv[4]||4100);
if(!Number.isInteger(apiPort)||apiPort<1||apiPort>65535)throw Error('Invalid API port');
const root=path.resolve('apps',kind,'dist'),assets=path.resolve('apps/frontoffice/public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/v1/')) {
   const headers={...req.headers};delete headers.host;
   const response=await fetch('http://127.0.0.1:'+apiPort+url.pathname+url.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req),duplex:'half',redirect:'manual'});
   const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
   res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([k])=>!['content-encoding','content-length','set-cookie'].includes(k))));
   if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let base=root;
  if(url.pathname.startsWith('/assets/')) { try { await fs.access(path.join(root,url.pathname)); } catch { base=assets; } }
  const ownPanelPath=kind==='owner'?/^\/(?:firma|company)(?:\/|$)/:/^\/operator(?:\/|$)/;
  if(ownPanelPath.test(url.pathname)||/^\/logowanie(?:\/|$)/.test(url.pathname)) {
   const canonical=canonicalPanelPath(url.pathname+url.search);
   if(canonical!==url.pathname+url.search){res.writeHead(308,{Location:canonical});res.end();return;}
  }
  const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let file=path.resolve(base,relative);
  if(!file.startsWith(base+path.sep)){file=path.join(root,'index.html');}
  try{if(!(await fs.stat(file)).isFile())throw Error();}catch{if(path.extname(relative)){res.writeHead(404);res.end();return;}file=path.join(root,'index.html');}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Cache-Control',file.endsWith('index.html')?'no-store':'public, max-age=3600');
  res.end(req.method==='HEAD'?undefined:await fs.readFile(file));
 }catch{if(!res.headersSent)res.writeHead(502);res.end();}
}).listen(Number(process.argv[3]),'127.0.0.1');
