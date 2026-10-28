import {fork} from 'node:child_process';import{inspectUri}from'./origin-diagnostics.mjs';
export {assignedPinnedOrigin as assignedOrigin}from'./service-origin-pin.mjs';
import{assignedPinnedOrigin as assignedOrigin,resourcePin}from'./service-origin-pin.mjs';
export function originStructure(t){
 const typ=v=>v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':typeof v;
 const ports=t?.ports,port=Array.isArray(ports)&&ports.length===1?ports[0]:undefined,uris=port?.portForwardingUris;
 const shape={portsType:typ(ports),portsCount:Array.isArray(ports)?ports.length:0,uriFieldPresent:!!port&&Object.hasOwn(port,'portForwardingUris'),uriType:typ(uris),uriCount:Array.isArray(uris)?uris.length:0};
 shape.uriDiagnostics=Array.isArray(uris)?uris.slice(0,3).map(raw=>inspectUri(raw,t.tunnelId)):[];shape.diagnosticsTruncated=Array.isArray(uris)&&uris.length>3;
 // Hostname is emitted ONLY after the original exact-origin validator succeeds.
 try{const u=new URL(assignedOrigin(t));shape.validatedOrigin=u.origin;shape.validatedTlsPort=Number(u.port||443);}catch{}
 return shape;
}
export async function pinProxy(t,configPath,pinPath){
 const origin=assignedOrigin(t);if(!pinPath)throw Error('Required resource origin pin absent');
 const child=fork(new URL('./review-proxy.mjs',import.meta.url),[],{env:{...process.env,REVIEW_ORIGIN:origin,BARBER_ORIGIN_PIN_PATH:pinPath,BARBER_RESOURCE_ID:t.tunnelId,BARBER_REVIEW_CONFIG_PATH:configPath},stdio:['ignore','ignore','ignore','ipc']});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('Private proxy startup timeout'));},5000);
  child.once('error',()=>{clearTimeout(timer);reject(Error('Private proxy startup failed'));});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Private proxy startup failed'));});
  child.once('message',m=>{clearTimeout(timer);if(m?.ready===true)resolve();else{child.kill();reject(Error('Invalid private proxy readiness'));}});
 });
 return {origin,stop:()=>child.kill('SIGTERM')};
}
