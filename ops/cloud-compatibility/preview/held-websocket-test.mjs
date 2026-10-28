process.env.BARBER_PROXY_FIXTURE='1';
// REAL Chromium-native WebSocket through production proxy code; SYNTHETIC upstream.
// No Supabase or tunnel calls. Asserts one continuous socket, not reconnect behavior.
import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{createRequire}from'node:module';
const require=createRequire(new URL('../../../package.json',import.meta.url));const{chromium}=require('playwright');const{WebSocketServer}=require('ws');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'barber-held-'));const cfg=path.join(dir,'config.json');fs.writeFileSync(cfg,JSON.stringify({publishableKey:'sb_publishable_SYNTHETIC_FIXTURE'}));process.env.BARBER_REVIEW_CONFIG_PATH=cfg;
let browser,proxy,fixture,wss;let connections=0,heartbeats=0;const results=[];
const watchdog=setTimeout(()=>{console.log(JSON.stringify({status:'FAIL',reason:'90s hard bound'}));process.exit(1);},90000);
try{
 fixture=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Synthetic held socket fixture</title>');});
 wss=new WebSocketServer({server:fixture});wss.on('connection',s=>{connections++;const id=connections;s.on('message',raw=>{const m=JSON.parse(raw);if(m.kind==='heartbeat'){heartbeats++;s.send(JSON.stringify({kind:'heartbeat_ack',id}));}if(m.kind==='positive_after_hold')s.send(JSON.stringify({kind:'positive_event',id}));});});
 await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const port=fixture.address().port;
 const{createProxy}=await import('./review-proxy.mjs');proxy=createProxy((opts,cb)=>http.request({...opts,port},cb));await new Promise((r,j)=>{proxy.once('error',j);proxy.listen(5180,'127.0.0.1',r);});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage();await page.goto('http://127.0.0.1:5180/');
 const observed=await page.evaluate(()=>new Promise((resolve,reject)=>{const ws=new WebSocket('ws://127.0.0.1:5180/realtime/v1/websocket');let opens=0,acks=0,closed=false,start;let interval;
 ws.onopen=()=>{opens++;start=performance.now();interval=setInterval(()=>ws.send(JSON.stringify({kind:'heartbeat'})),5000);setTimeout(()=>{if(ws.readyState!==WebSocket.OPEN)return reject(Error('not continuously open'));ws.send(JSON.stringify({kind:'positive_after_hold'}));},71000);};
 ws.onerror=()=>reject(Error('native socket error'));ws.onclose=()=>{closed=true;clearInterval(interval);};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.kind==='heartbeat_ack')acks++;if(m.kind==='positive_event'){const elapsed=performance.now()-start;resolve({opens,acks,closedBeforeEvent:closed,elapsedMs:elapsed,socketId:m.id,stateAtEvent:ws.readyState});clearInterval(interval);ws.close();}};
 }));
 results.push({name:'held browser-native socket with heartbeats and positive event',status:observed.opens===1&&observed.acks>=14&&!observed.closedBeforeEvent&&observed.elapsedMs>=70000&&connections===1&&observed.socketId===1&&observed.stateAtEvent===1?'PASS':'FAIL',...observed,upstreamConnections:connections,heartbeats,evidence:'REAL local wire/Chromium; SYNTHETIC upstream; not backend or owner access proof'});
 console.log(JSON.stringify(results,null,2));process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
}catch{console.log(JSON.stringify({status:'FAIL',reason:'held socket test failed; no credential diagnostics'}));process.exitCode=1;}
finally{clearTimeout(watchdog);await browser?.close();for(const s of wss?.clients||[])s.terminate();await new Promise(r=>wss?wss.close(r):r());proxy?.closeAllConnections();await new Promise(r=>proxy?proxy.close(r):r());fixture?.closeAllConnections();await new Promise(r=>fixture?fixture.close(r):r());fs.rmSync(dir,{recursive:true,force:true});}
