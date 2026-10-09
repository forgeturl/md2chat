const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
http.createServer((req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 try{
  let route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(route.startsWith('/md2chat/'))route=route.slice('/md2chat'.length);
  if(route==='/')route='/index.html';
  // Only public site assets are exposed by the development server.
  if(route!=='/index.html'&&!route.startsWith('/assets/')){res.writeHead(404);res.end();return;}
  const file=path.resolve(root,'.'+route);
  if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
 }catch(_){res.writeHead(404);res.end();}
}).listen(18768,'127.0.0.1',()=>console.log('md2chat: http://127.0.0.1:18768/md2chat/'));
