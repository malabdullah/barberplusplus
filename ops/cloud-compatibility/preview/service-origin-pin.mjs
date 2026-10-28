import fs from'node:fs';import path from'node:path';
const CONTROL='https://use.rel.tunnels.api.visualstudio.com';const pins=new Map();
const fields=['schema','controlOrigin','resourceId','clusterId','portNumber','endpointId','hostId','hostKeySha256','origin','pinnedAt'];
export function pinFailure(code){const e=Error('Service origin pin rejected');e.code=code;throw e;}
export function canonicalServiceOrigin(candidate){
 if(typeof candidate!=='string'||candidate.length>2048)pinFailure('ORIGIN_URI_INVALID');
 let u;try{u=new URL(candidate);}catch{pinFailure('ORIGIN_URI_INVALID');}
 const authority=candidate.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1]||'';
 if(u.protocol!=='https:'||u.port||u.pathname!=='/'||u.username||u.password||authority.includes('@')||u.href.includes('?')||u.href.includes('#'))pinFailure('ORIGIN_URI_UNTRUSTED');
 const host=u.hostname;const labels=host.split('.');
 if(host.length>253||labels.length<3||!host.endsWith('.devtunnels.ms')||labels.some(s=>s.length<1||s.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))pinFailure('ORIGIN_URI_UNTRUSTED');
 return 'https://'+host; // canonical literal; no candidate path, port, credentials or delimiters.
}
export function validatePin(pin,resourceId){
 if(!pin||Object.keys(pin).length!==fields.length||Object.keys(pin).some(k=>!fields.includes(k))||pin.schema!==1||pin.controlOrigin!==CONTROL||!/^barber-[0-9a-f]{24}$/.test(pin.resourceId)||pin.resourceId!==resourceId||pin.clusterId!=='use'||pin.portNumber!==5180||!['endpointId','hostId'].every(k=>typeof pin[k]==='string'&&/^[A-Za-z0-9._-]{1,200}$/.test(pin[k]))||!/^[0-9a-f]{64}$/.test(pin.hostKeySha256)||!Number.isFinite(Date.parse(pin.pinnedAt))||canonicalServiceOrigin(pin.origin)!==pin.origin)pinFailure('ORIGIN_PIN_INVALID');
 return pin;
}
export function bindEndpointOrigin(binding,candidate){
 const origin=canonicalServiceOrigin(candidate);const pin=validatePin({...binding,schema:1,origin,pinnedAt:new Date().toISOString()},binding.resourceId);
 const old=pins.get(pin.resourceId);
 if(old){if(fields.filter(k=>k!=='pinnedAt').some(k=>old[k]!==pin[k]))pinFailure('ORIGIN_PIN_CHANGE');return old;}
 const fixed=Object.freeze(pin);pins.set(pin.resourceId,fixed);return fixed;
}
export function resourcePin(t){
 if(t?.clusterId!=='use'||!/^barber-[0-9a-f]{24}$/.test(t.tunnelId)||t.ports?.length!==1||t.ports[0].portNumber!==5180||(t.accessControl?.entries||[]).length||(t.ports[0].accessControl?.entries||[]).length)pinFailure('ORIGIN_IDENTITY_MISMATCH');
 const pin=pins.get(t.tunnelId);if(!pin)pinFailure('ORIGIN_PIN_REQUIRED');return pin;
}
export function assignedPinnedOrigin(t){
 const pin=resourcePin(t);const uris=t.ports[0].portForwardingUris;
 if(!Array.isArray(uris)||!uris.length)pinFailure('ORIGIN_URI_ABSENT');
 if(uris.some(uri=>canonicalServiceOrigin(uri)!==pin.origin))pinFailure('ORIGIN_PIN_CHANGE');return pin.origin;
}
function privateRoot(root){
 const real=fs.realpathSync(root),st=fs.statSync(real);
 if(real!==path.resolve(root)||!real.startsWith('/dev/shm/barber-owner-')||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||Number(fs.statfsSync(real).type)!==0x01021994)pinFailure('ORIGIN_PIN_INVALID');return real;
}
export function savePinReceipt(root,pin){
 validatePin(pin,pin.resourceId);if(pins.get(pin.resourceId)!==pin)pinFailure('ORIGIN_PIN_INVALID');
 const file=path.join(privateRoot(root),'origin-pin.json');let fd;
 try{fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(pin));fs.fsyncSync(fd);}catch{pinFailure('ORIGIN_PIN_CHANGE');}finally{if(fd!==undefined)fs.closeSync(fd);}return file;
}
export function readPinReceipt(file,resourceId){
 const root=privateRoot(path.dirname(file));if(path.basename(file)!=='origin-pin.json'||path.resolve(file)!==path.join(root,'origin-pin.json'))pinFailure('ORIGIN_PIN_INVALID');
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.nlink!==1||st.size>4096)pinFailure('ORIGIN_PIN_INVALID');return Object.freeze(validatePin(JSON.parse(fs.readFileSync(fd,'utf8')),resourceId));}catch{pinFailure('ORIGIN_PIN_INVALID');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
