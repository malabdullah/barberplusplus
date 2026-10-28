import{loadRouting}from'./profile-routing.mjs';
import http from 'node:http';import{readPinReceipt}from'./service-origin-pin.mjs';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
const routing=loadRouting();
const livePin=process.env.BARBER_ORIGIN_PIN_PATH?readPinReceipt(process.env.BARBER_ORIGIN_PIN_PATH,process.env.BARBER_RESOURCE_ID):null;
const origin=livePin?livePin.origin:'http://127.0.0.1:5180',site=new URL(origin);
if(process.env.REVIEW_ORIGIN&&process.env.REVIEW_ORIGIN!==origin)throw Error('Origin must equal the single resource pin');
if(site.origin!==origin||(!['https:'].includes(site.protocol)&&origin!=='http://127.0.0.1:5180'))throw Error('Exact HTTPS origin required');
const tables=new Set('admin_settings areas audit_logs barbers bookings branches customers governorates logs notification_templates notifications services suspicious_activities user_notification_preferences user_settings whatsapp_conversations whatsapp_logs whatsapp_messages'.split(' '));
const rpcs=new Set(['count_users_by_role','get_managers','get_manager_by_id']);
const browserConfig=JSON.parse(fs.readFileSync(process.env.BARBER_REVIEW_CONFIG_PATH||new URL('./review-config.json',import.meta.url),'utf8'));
if(!browserConfig.publishableKey?.startsWith('sb_publishable_')||(process.env.BARBER_PROXY_FIXTURE!=='1'&&browserConfig.publishableKey!==routing.publishableKey))throw Error('Selected profile publishable key required');
const config='window.__BARBER_CONFIG__ = '+JSON.stringify({environment:site.protocol==='https:'?'staging':'test',cloudProfile:routing.profile,appUrl:origin,supabaseUrl:origin,supabasePublishableKey:browserConfig.publishableKey})+';';
export function target(req,upgrade=false){
 if(req.headers.host!==site.host||req.headers.origin&&req.headers.origin!==origin)return null;
 if(!req.url.startsWith('/')||req.url.startsWith('//')||/[\\\x00-\x20#]/.test(req.url))return null;
 let p;try{p=decodeURIComponent(req.url.split('?')[0]);}catch{return null;}
 if(p.includes('%')||p.includes('\\')||p.split('/').some(x=>x==='.'||x==='..')||p.includes('//'))return null;
 if(upgrade)return p==='/realtime/v1/websocket'&&req.method==='GET'&&req.headers.origin===origin&&req.headers.upgrade?.toLowerCase()==='websocket'?routing.apiPort:null;
 if(req.headers.upgrade)return null;
 const m=req.method;
 if(p==='/runtime-config.js'&&['GET','HEAD'].includes(m))return 'config';
 if(['GET','HEAD'].includes(m)&&(/^(?:\/(?:login|forgot-password|reset-password|accept-invite)?|\/(?:dashboard|admin|agent|barber)(?:\/[a-zA-Z0-9_-]+)*|\/assets\/[a-zA-Z0-9_.-]+|\/favicon.svg)$/.test(p)))return routing.frontendPort;
 const auth={'token':['POST'],'logout':['POST'],'recover':['POST'],'user':['GET','PUT'],'verify':['GET','POST'],'settings':['GET']};
 if(auth[p.slice(9)]?.includes(m)&&p.startsWith('/auth/v1/'))return routing.apiPort;
 if(/^\/rest\/v1\/[^/]+$/.test(p)&&tables.has(p.split('/')[3])&&['GET','HEAD','POST','PATCH','DELETE'].includes(m))return routing.apiPort;
 if(/^\/rest\/v1\/rpc\/[^/]+$/.test(p)&&rpcs.has(p.split('/')[4])&&['GET','POST'].includes(m))return routing.apiPort;
 if(/^\/storage\/v1\/object\/(?:authenticated\/)?(?:avatars|cloud-compat-private|cloud-candidate-private)\/[a-zA-Z0-9_./-]+$/.test(p)&&['GET','HEAD','POST','PUT','DELETE'].includes(m))return routing.apiPort;
 if(/^\/functions\/v1\/(?:auth-rate-limiter|invite-barber)$/.test(p)&&['POST','OPTIONS'].includes(m))return routing.apiPort;
 return null;
}
export function headers(req,upgrade=false){
 const h={host:'127.0.0.1:'+routing.apiPort};
 for(const k of ['authorization','apikey','content-type','accept','range','prefer','accept-profile','content-profile','x-client-info','sec-websocket-key','sec-websocket-version','sec-websocket-protocol'])if(req.headers[k])h[k]=req.headers[k];
 if(upgrade){h.connection='Upgrade';h.upgrade='websocket';h.origin=origin;}
 return h;
}
export function authLocation(req,location){
 if(!req.url.startsWith('/auth/v1/')||typeof location!=='string'||/[\\\x00-\x20]/.test(location)||location.startsWith('//'))return null;
 try{const u=new URL(location,origin);if(u.origin!==origin||u.username||u.password||!['/','/login','/reset-password','/accept-invite'].includes(u.pathname))return null;return u.href;}catch{return null;}
}
const deny=res=>{res.writeHead(403,{'cache-control':'no-store'});res.end('Denied');};
export function createProxy(request=http.request){
const server=http.createServer((req,res)=>{
 const t=target(req);if(!t)return deny(res);
 if(t==='config'){res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(req.method==='HEAD'?'':config);}
 if(req.headers['transfer-encoding']&&req.headers['content-length'])return deny(res);
 if(Number(req.headers['content-length']||0)>1048576){res.writeHead(413,{'connection':'close'});return res.end('Body too large');}
 const chunks=[];let size=0;
 req.on('data',c=>{size+=c.length;if(size>1048576){res.writeHead(413);res.end();req.destroy();}else chunks.push(c);});
 req.on('end',()=>{if(size>1048576)return;const h=headers(req);h.host='127.0.0.1:'+t;h['content-length']=size;
  const up=request({host:'127.0.0.1',port:t,path:req.url,method:req.method,headers:h,timeout:15000},r=>{
   if(r.statusCode>=300&&r.statusCode<400){const location=authLocation(req,r.headers.location);if(!location){r.resume();res.writeHead(502);return res.end('Untrusted redirect denied');}res.writeHead(r.statusCode,{'location':location,'cache-control':'no-store'});r.resume();return res.end();}
   const out={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
   for(const k of ['content-type','content-range','content-disposition'])if(r.headers[k])out[k]=r.headers[k];
   out['content-security-policy']="default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";
   if(t===routing.frontendPort&&r.headers['content-type']?.includes('text/html')){
    const chunks=[];let bytes=0;r.on('data',c=>{bytes+=c.length;if(bytes>1048576)r.destroy();else chunks.push(c);});r.on('end',()=>{const html=Buffer.concat(chunks).toString().replace(/<link\b[^>]*href=["']https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^"']*["'][^>]*>/g,'');res.writeHead(r.statusCode,out);res.end(html);});r.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local upstream unavailable');});
   }else{res.writeHead(r.statusCode,out);r.pipe(res);}
  });up.on('timeout',()=>up.destroy());up.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local upstream unavailable');});up.end(Buffer.concat(chunks));
 });
});
server.on('upgrade',(req,socket,head)=>{
 if(!target(req,true)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
 const up=request({host:'127.0.0.1',port:routing.apiPort,path:req.url,headers:headers(req,true),timeout:15000});
 up.on('upgrade',(r,peer,uphead)=>{up.setTimeout(0);peer.setTimeout(0);socket.setTimeout(0);socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(r.headers).filter(([k])=>['upgrade','connection','sec-websocket-accept','sec-websocket-protocol'].includes(k)).map(([k,v])=>k+': '+v+'\r\n').join('')+'\r\n');if(uphead.length)socket.write(uphead);if(head.length)peer.write(head);socket.pipe(peer).pipe(socket);socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy());socket.on('close',()=>peer.destroy());});
 up.on('response',r=>{r.resume();socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});up.on('timeout',()=>up.destroy());up.on('error',()=>socket.destroy());up.end();
});
return server;
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
const server=createProxy();
server.requestTimeout=20000;server.headersTimeout=10000;server.listen(5180,'127.0.0.1',()=>{if(process.send)process.send({ready:true});});
setTimeout(()=>{server.closeAllConnections();server.close();process.exit(0);},3600000).unref();

}
