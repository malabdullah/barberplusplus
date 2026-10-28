process.env.BARBER_PROXY_FIXTURE='1';
// REAL local HTTP; SYNTHETIC Auth redirects. No backend calls.
import http from'node:http';import fs from'node:fs';import os from'node:os';import path from'node:path';import assert from'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'barber-location-wire-'));const cfg=path.join(dir,'config.json');fs.writeFileSync(cfg,JSON.stringify({publishableKey:'sb_publishable_DUMMY'}));process.env.BARBER_REVIEW_CONFIG_PATH=cfg;
let proxy,fixture;let value='/reset-password#access_token=SYNTHETIC';let checks=0;
try{fixture=http.createServer((req,res)=>{res.writeHead(303,{location:value});res.end();});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const{createProxy}=await import('./review-proxy.mjs');proxy=createProxy((o,cb)=>http.request({...o,port:fixture.address().port},cb));await new Promise((r,j)=>{proxy.once('error',j);proxy.listen(5180,'127.0.0.1',r);});
 const request=()=>new Promise((resolve,reject)=>{http.get('http://127.0.0.1:5180/auth/v1/verify',r=>{r.resume();r.on('end',()=>resolve(r));}).on('error',reject);});
 let r=await request();assert.equal(r.statusCode,303);assert.equal(r.headers.location,'http://127.0.0.1:5180'+value);checks++;
 for(value of ['https://evil.example/reset-password','//evil.example/login','http://user@127.0.0.1:5180/login','/functions/v1/invite-barber']){r=await request();assert.equal(r.statusCode,502);assert.equal(r.headers.location,undefined);checks++;}
 console.log(JSON.stringify({checks,failed:0,evidence:'REAL local HTTP; SYNTHETIC Auth upstream'}));
}finally{proxy?.closeAllConnections();await new Promise(r=>proxy?proxy.close(r):r());fixture?.closeAllConnections();await new Promise(r=>fixture?fixture.close(r):r());fs.rmSync(dir,{recursive:true,force:true});}
