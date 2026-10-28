process.env.BARBER_PROXY_FIXTURE='1';
import fs from'node:fs';import os from'node:os';import path from'node:path';import assert from'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'barber-redirect-'));const cfg=path.join(dir,'config.json');fs.writeFileSync(cfg,JSON.stringify({publishableKey:'sb_publishable_DUMMY'}));process.env.BARBER_REVIEW_CONFIG_PATH=cfg;
const{authLocation}=await import('./review-proxy.mjs');const r={url:'/auth/v1/verify'};const base='http://127.0.0.1:5180';let count=0;
try{for(const p of ['/reset-password#access_token=DUMMY','/accept-invite?code=SYNTHETIC',base+'/login']){assert.equal(new URL(authLocation(r,p)).origin,base);count++;}
 for(const p of ['https://evil.example/reset-password','//evil.example/login','http://127.0.0.1:5180.evil.example/login','http://user@127.0.0.1:5180/login','/rest/v1/bookings','/login\r\nBad:header','/\\evil.example/login','javascript:alert(1)']){assert.equal(authLocation(r,p),null);count++;}
 assert.equal(authLocation({url:'/assets/app.js'},'/login'),null);count++;
 console.log(JSON.stringify({checks:count,failed:0,evidence:'SYNTHETIC redirect policy; no account/backend request'}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
