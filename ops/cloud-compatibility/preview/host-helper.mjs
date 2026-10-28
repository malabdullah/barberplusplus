// REVIEW ARTIFACT. Direct execution is plan-only. No authorization implementation.
import crypto from 'node:crypto';import{receipt,errorCategory}from'./lifecycle-receipts.mjs';
export const plan=Object.freeze({region:'use',regionName:'EastUs',control:'use.rel.tunnels.api.visualstudio.com',relay:'use-data.rel.tunnels.api.visualstudio.com',target:'127.0.0.1:5180',port:5180,lifetimeSeconds:3600,creatorOnly:true});
export function newSpec(){return {clusterId:plan.region,tunnelId:'barber-'+crypto.randomBytes(12).toString('hex'),customExpiration:3600,accessControl:{entries:[]},options:{isHostHeaderUnchanged:true,isOriginHeaderUnchanged:true,isInspectionEnabled:false},ports:[{portNumber:5180,protocol:'http',accessControl:{entries:[]}}]};}
function valid(t,s){return t?.tunnelId===s.tunnelId&&t.clusterId===s.clusterId;}
export function safeError(){return {code:'PREVIEW_OPERATION_FAILED',detail:'Raw SDK/credential error suppressed'};}
// Injected adapters permit deterministic MOCK tests. No caller-supplied existing ID.
// The supervisor must retain this process in the private Secret Service session.
export async function orchestrate({management,makeHost,wait,beforeHost=async()=>{throw Error('Assigned origin review required');},signal,record=receipt,deadlineMs=3590000}){
 if(deadlineMs<1||deadlineMs>3600000)throw Error('Invalid deadline');
 const spec=newSpec();record('PLANNED',spec.tunnelId);let created=false,host,cleanupDone=false;const stop=new AbortController();
 const clean=async()=>{if(cleanupDone)return;cleanupDone=true;stop.abort();try{if(host){record('HOST_DISPOSE_STARTED',spec.tunnelId);await host.dispose();record('HOST_DISPOSED',spec.tunnelId);}}finally{if(created){record('DELETE_STARTED',spec.tunnelId);try{const deleted=await management.deleteTunnel({clusterId:spec.clusterId,tunnelId:spec.tunnelId});if(deleted!==true)throw Error('Delete not confirmed');record('DELETE_CONFIRMED',spec.tunnelId);}catch(e){record('DELETE_FAILED',spec.tunnelId,errorCategory(e));throw Error('DELETE_FAILED');}}}};
 const externalStop=()=>stop.abort();signal?.addEventListener('abort',externalStop,{once:true});if(signal?.aborted)stop.abort();
 const timer=setTimeout(()=>{stop.abort();},deadlineMs);
 try{
  record('CREATE_STARTED',spec.tunnelId);
  let t;try{t=await management.createTunnel(spec,{includePorts:true,tokenScopes:['host'],additionalHeaders:{'If-None-Match':'*'}},stop.signal);}catch(e){record('CREATE_FAILED',spec.tunnelId,errorCategory(e));throw Error('CREATE_FAILED');}
  // Never delete an unexpected ID: uncertain results require manual service inspection.
  if(!valid(t,spec))throw Error('Unexpected resource identity');created=true;record('CREATED_CONFIRMED',spec.tunnelId);
  if((t.accessControl?.entries||[]).length||t.ports?.length!==1||t.ports[0].portNumber!==5180||(t.ports[0].accessControl?.entries||[]).length)throw Error('Unexpected access or ports');
  if(stop.signal.aborted)throw Error('Deadline elapsed');
  record('ACL_VALIDATED',spec.tunnelId);
  host=makeHost({identity:t,beforeRelay:beforeHost,record,signal:stop.signal});record('HOST_SETUP_STARTED',spec.tunnelId);await host.connect(t,{enableRetry:false,enableReconnect:false},stop.signal);
  record('HOST_CONNECTED',spec.tunnelId);await wait(stop.signal);
 }catch(e){record('OPERATION_FAILED',spec.tunnelId,errorCategory(e));throw Error('PREVIEW_OPERATION_FAILED');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',externalStop);try{await clean();}catch{throw Error('PREVIEW_CLEANUP_FAILED; raw error suppressed');}}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)console.log(JSON.stringify({mode:'PLAN ONLY; no network/auth/create/host',...plan},null,2));
