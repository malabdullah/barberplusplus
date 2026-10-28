process.env.BARBER_PROXY_FIXTURE='1';
import assert from 'node:assert/strict';
import http from 'node:http';

import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'barber-policy-dummy-'));const cfg=path.join(dir,'config.json');fs.writeFileSync(cfg,JSON.stringify({publishableKey:'sb_publishable_DUMMY'}));process.env.BARBER_REVIEW_CONFIG_PATH=cfg;
const{target,headers}=await import('./review-proxy.mjs');fs.rmSync(dir,{recursive:true});
const results=[];function check(name,ok){results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);}
const request=(url,method='GET',extra={})=>({url,method,headers:{host:'127.0.0.1:5180',...extra}});
for(const p of ['http://example.com/','//example.com/','/../REPORT.md','/%2e%2e/REPORT.md','/%252e%252e/a','/assets/../.env','/.env','/.git/config','/auth/v1/admin/users','/rest/v1/booking_reminders','/rest/v1/rpc/unknown','/functions/v1/whatsapp-webhook','/mail','/artifacts/x','/realtime/v1/websocket'])check('deny '+p,target(request(p))===null);
check('host pin',target(request('/','GET',{host:'evil.example'}))===null);
check('origin pin',target(request('/auth/v1/token','POST',{origin:'https://evil.example'}))===null);
check('upgrade requires origin',target(request('/realtime/v1/websocket','GET',{upgrade:'websocket'}),true)===null);
check('upgrade target pin',target(request('/auth/v1/user','GET',{upgrade:'websocket',origin:'http://127.0.0.1:5180'}),true)===null);
const safe=headers(request('/auth/v1/user','GET',{cookie:'tunnel=private; session=private','x-tunnel-authorization':'private',authorization:'Bearer synthetic','x-forwarded-host':'evil',connection:'authorization'}));
check('tunnel cookie/token/forward headers stripped',!safe.cookie&&!safe['x-tunnel-authorization']&&!safe['x-forwarded-host']);check('app JWT preserved',safe.authorization==='Bearer synthetic');
console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>x.status!=='PASS').length}));
