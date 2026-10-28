// Decorate only the SDK's PUBLIC management updateTunnelEndpoint path.
// No private SDK hooks, invented URL, token output, or transport replacement in production.
import{createHash}from'node:crypto';import{bindEndpointOrigin}from'./service-origin-pin.mjs';
import{createRequire}from'node:module';import{assignedOrigin,originStructure}from'./origin-pin.mjs';import{errorCategory}from'./lifecycle-receipts.mjs';
const require=createRequire(new URL('./sdk-scratch/package.json',import.meta.url));const{TunnelEndpoint,TunnelConnectionMode}=require('@microsoft/dev-tunnels-contracts');
function reject(code){const e=Error('Endpoint preparation rejected');e.code=code;throw e;}
export function prepareEndpointClient(client,{identity,beforeRelay,enableForwarding,record,signal,controlOrigin}){
 const id=identity.tunnelId;let used=false;
 const checkIdentity=t=>{if(t?.tunnelId!==id||t.clusterId!=='use'||!/^barber-[0-9a-f]{24}$/.test(id)||identity.clusterId!=='use'||identity.ports?.length!==1||identity.ports[0].portNumber!==5180)reject('ENDPOINT_IDENTITY_MISMATCH');};
 const checkCancelled=()=>{if(signal?.aborted)reject('ENDPOINT_CANCELLED');};
 return new Proxy(client,{get(target,key){
  if(key!=='updateTunnelEndpoint'){const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}
  return async(t,request,options,cancellation)=>{
   try{
    if(controlOrigin!=='https://use.rel.tunnels.api.visualstudio.com')reject('ENDPOINT_CONTROL_INVALID');
    checkIdentity(t);checkCancelled();if(used)reject('ENDPOINT_DUPLICATE_REGISTRATION');used=true;
    if(!request?.id||!request.hostId||request.connectionMode!==TunnelConnectionMode.TunnelRelay)reject('ENDPOINT_IDENTITY_MISMATCH');
    const keys=request.hostPublicKeys;
    if(!Array.isArray(keys)||!keys.length||keys.some(k=>typeof k!=='string'||!k)||new Set(keys).size!==keys.length)reject('ENDPOINT_PUBLIC_KEY_MISMATCH');
    // Create-time URIs are UNUSED metadata: diagnostics only, never an authorization precondition.
    record('CREATE_ORIGIN_METADATA',id,'NONE',originStructure(t));
    record('ENDPOINT_REGISTRATION_STARTED',id);
    const endpoint=await target.updateTunnelEndpoint(t,request,options,cancellation);
    record('ENDPOINT_REGISTERED',id);checkCancelled();
    if(!endpoint||endpoint.id!==undefined&&endpoint.id!==request.id||endpoint.hostId!==request.hostId||endpoint.connectionMode!==TunnelConnectionMode.TunnelRelay||endpoint.clusterId!==undefined&&endpoint.clusterId!=='use'||endpoint.tunnelId!==undefined&&endpoint.tunnelId!==id)reject('ENDPOINT_IDENTITY_MISMATCH');
    if(endpoint.hostPublicKeys!==undefined&&(!Array.isArray(endpoint.hostPublicKeys)||JSON.stringify([...endpoint.hostPublicKeys].sort())!==JSON.stringify([...keys].sort())))reject('ENDPOINT_PUBLIC_KEY_MISMATCH');
    let relay;try{relay=new URL(endpoint.hostRelayUri);}catch{reject('ENDPOINT_RELAY_INVALID');}
    if(relay.protocol!=='wss:'||relay.hostname!=='use-data.rel.tunnels.api.visualstudio.com'||relay.port&&relay.port!=='443'||relay.username||relay.password||relay.hash)reject('ENDPOINT_RELAY_INVALID');
    // Official helper output is inspected before rejecting format/origin; diagnostics never select it.
    const uri=typeof endpoint.portUriFormat==='string'?TunnelEndpoint.getPortUri(endpoint,5180):undefined;
    const resolved={...t,ports:[{...t.ports[0],portForwardingUris:[uri]}]};
    record('ORIGIN_SELECTION_STARTED',id,'NONE',originStructure(resolved));
    if(typeof endpoint.portUriFormat!=='string'||endpoint.portUriFormat.split('{port}').length!==2)reject('ENDPOINT_URI_ABSENT');
    const pin=bindEndpointOrigin({controlOrigin,resourceId:id,clusterId:'use',portNumber:5180,endpointId:request.id,hostId:request.hostId,hostKeySha256:createHash('sha256').update(JSON.stringify([...keys].sort())).digest('hex')},uri);
    const canonicalOrigin=assignedOrigin(resolved);record('ORIGIN_PINNED',id,'NONE',undefined,pin);record('ORIGIN_VALIDATED',id);checkCancelled();
    resolved.ports[0].portForwardingUris=[canonicalOrigin+'/'];
    record('AUTH_RECONCILE_STARTED',id);await beforeRelay(resolved);checkCancelled();
    record('PROXY_READY',id);enableForwarding();record('FORWARDING_ENABLED',id);
    record('HOST_CONNECT_STARTED',id);
    // Pinned host SDK cannot obtain hostRelayUri/start the relay stream until this returns.
    return endpoint;
   }catch(e){record('ENDPOINT_PREPARATION_FAILED',id,errorCategory(e));throw e;}
  };
 }});
}
