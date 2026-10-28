// Fresh synthetic RAM receipt + real local proxy. No OAuth, service or backend writes.
import fs from'node:fs';import http from'node:http';import path from'node:path';import{execFileSync}from'node:child_process';
import assert from'node:assert/strict';import{bindEndpointOrigin,savePinReceipt,readPinReceipt}from'./service-origin-pin.mjs';import{pinProxy}from'./origin-pin.mjs';
const root=fs.mkdtempSync('/dev/shm/barber-owner-pin-test-');fs.chmodSync(root,0o700);const results=[];let proxy;
function check(name,ok){results.push({name,status:ok?'PASS':'FAIL',evidence:'SYNTHETIC pin + local loopback only'});if(!ok)throw Error('HANDOFF_ASSERTION');}
const id='barber-'+'e'.repeat(24),origin='https://opaque-pinned-service.use.devtunnels.ms';
try{
 const pin=bindEndpointOrigin({controlOrigin:'https://use.rel.tunnels.api.visualstudio.com',resourceId:id,clusterId:'use',portNumber:5180,endpointId:'MOCK_ENDPOINT',hostId:'MOCK_HOST',hostKeySha256:'0'.repeat(64)},origin);
 const file=savePinReceipt(root,pin);check('fresh RAM receipt private and exact', (fs.statSync(file).mode&0o777)===0o600&&readPinReceipt(file,id).origin===origin);
 assert.throws(()=>readPinReceipt(file,'barber-'+'f'.repeat(24)));check('wrong resource receipt rejected',true);
 assert.throws(()=>savePinReceipt(root,pin));check('receipt cannot be overwritten',true);
 const code=`import importlib.util,json,tomllib,sys\nfrom pathlib import Path\np=Path(${JSON.stringify(new URL('./auth-origin.py',import.meta.url).pathname)});s=importlib.util.spec_from_file_location('a',p);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)\nroot=Path(sys.argv[1]);pin=a.read_origin_pin(root,sys.argv[2],sys.argv[3]);old=a.CONFIG.read_bytes();before=tomllib.loads(old.decode());after=tomllib.loads(a.revised(old,pin['origin']).decode());assert after['auth']['site_url']==pin['origin'] and after['edge_runtime']['secrets']['APP_URL']==pin['origin'];assert after['auth']['additional_redirect_urls']==[pin['origin']+'/accept-invite',pin['origin']+'/reset-password',pin['origin']+'/login'];expected=before['auth'].get('jwt_issuer')or before['auth'].get('external_url')or before['api'].get('external_url','http://127.0.0.1:'+str(before['api']['port'])).rstrip('/')+'/auth/v1';assert after['auth']['jwt_issuer']==expected;assert a.CONFIG.read_bytes()==old\ntry:a.read_origin_pin(root,sys.argv[2],'https://changed.devtunnels.ms')\nexcept ValueError:pass\nelse:raise AssertionError()\nprint('AUTH_PIN_HANDOFF_PASS')`;
 check('actual-file Auth transform uses same pin, preserves issuer and never writes',execFileSync('python3',['-c',code,root,id,origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()==='AUTH_PIN_HANDOFF_PASS');
 const config=path.join(root,'browser.json');fs.writeFileSync(config,JSON.stringify({publishableKey:JSON.parse(execFileSync('python3',[new URL('../runtime/export-route.py',import.meta.url).pathname,process.env.BARBER_CLOUD_PROFILE],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).publishableKey}),{mode:0o600});
 const t={tunnelId:id,clusterId:'use',ports:[{portNumber:5180,portForwardingUris:[origin+'/']}]};proxy=await pinProxy(t,config,file);
 const request=(host,requestOrigin)=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:5180,path:'/runtime-config.js',headers:{host,origin:requestOrigin}},r=>{const data=[];r.on('data',c=>data.push(c));r.on('end',()=>resolve({status:r.statusCode,body:Buffer.concat(data).toString()}));}).on('error',reject);});
 let response=await request(new URL(origin).host,origin);check('guarded proxy config uses exact receipt origin',response.status===200&&response.body.includes('"appUrl":"'+origin+'"')&&response.body.includes('"supabaseUrl":"'+origin+'"'));
 response=await request('changed.devtunnels.ms','https://changed.devtunnels.ms');check('different runtime Host/Origin denied',response.status===403);
 proxy.stop();proxy=null;
 fs.unlinkSync(file);check('synthetic receipt removed',!fs.existsSync(file));
}catch{if(!results.some(r=>r.status==='FAIL'))results.push({name:'handoff exception',status:'FAIL',category:'PIN_HANDOFF_FAILED'});}
finally{proxy?.stop();fs.rmSync(root,{recursive:true,force:true});results.push({name:'new RAM fixture cleanup',status:!fs.existsSync(root)?'PASS':'FAIL'});console.log(JSON.stringify(results,null,2));process.exitCode=results.some(r=>r.status==='FAIL')?1:0;}
