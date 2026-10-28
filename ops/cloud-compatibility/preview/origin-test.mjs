import{bindEndpointOrigin}from'./service-origin-pin.mjs';
import assert from 'node:assert/strict';import {assignedOrigin} from './origin-pin.mjs';
const id='barber-'+ 'a'.repeat(24),origin=`https://${id}-5180.use.devtunnels.ms`;
bindEndpointOrigin({controlOrigin:'https://use.rel.tunnels.api.visualstudio.com',resourceId:id,clusterId:'use',portNumber:5180,endpointId:'SYNTHETIC_ENDPOINT',hostId:'SYNTHETIC_HOST',hostKeySha256:'0'.repeat(64)},origin);
const good=()=>({clusterId:'use',tunnelId:id,ports:[{portNumber:5180,portForwardingUris:[origin+'/']}]});
const out=[];function test(name,f){try{f();out.push({name,status:'PASS',evidence:'SYNTHETIC validation; no network'});}catch{out.push({name,status:'FAIL'});}}
test('exact new ID/5180/use canonical origin',()=>assert.equal(assignedOrigin(good()),origin));
for(const [name,url]of Object.entries({wrongId:origin.replace('aaaa','bbbb'),wrongRegion:origin.replace('.use.','.euw.'),wrongPort:origin.replace('-5180','-5181'),suffixAttack:origin+'.evil.example',userinfo:'https://user@'+origin.slice(8),query:origin+'/?token=DUMMY',fragment:origin+'/#bad',http:origin.replace('https:','http:'),nondefaultPort:origin+':8443/',emptyQuery:origin+'/?',emptyFragment:origin+'/#',emptyUserinfo:'https://@'+origin.slice(8),trailingDot:origin.replace('.ms','.ms.'),path:origin+'/login',arbitrary:'https://other.use.devtunnels.ms/'}))test('reject '+name,()=>{const t=good();t.ports[0].portForwardingUris=[url];assert.throws(()=>assignedOrigin(t));});
for(const [name,url]of Object.entries({explicit443:origin+':443/',caseSerialization:origin.toUpperCase()+'/',escapedHost:origin.replace('barber','%62arber')+'/',normalizedRoot:origin+'/.',zeroPadded443:origin+':00443/'}))test('accept identical root origin '+name,()=>{const t=good();t.ports[0].portForwardingUris=[url];assert.equal(assignedOrigin(t),origin);});
test('reject extra unexpected assigned URI',()=>{const t=good();t.ports[0].portForwardingUris.push('https://evil.example/');assert.throws(()=>assignedOrigin(t));});
test('reject mismatched resource region',()=>{const t=good();t.clusterId='euw';assert.throws(()=>assignedOrigin(t));});
test('optional returned URI absent fails closed',()=>{const t=good();delete t.ports[0].portForwardingUris;assert.throws(()=>assignedOrigin(t));});
test('empty returned URI array fails closed',()=>{const t=good();t.ports[0].portForwardingUris=[];assert.throws(()=>assignedOrigin(t));});
console.log(JSON.stringify(out,null,2));process.exitCode=out.some(x=>x.status==='FAIL')?1:0;
