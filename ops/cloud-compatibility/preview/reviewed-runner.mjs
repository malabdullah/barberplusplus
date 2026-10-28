// Import-only. No network or credential lookup during import.
import fs from 'node:fs';import{resourcePin,savePinReceipt}from'./service-origin-pin.mjs';import{receipt}from'./lifecycle-receipts.mjs';import {configureProofAuth}from'./auth-origin.mjs';
import {orchestrate} from './host-helper.mjs';import {reviewedAdapters} from './reviewed-sdk-adapter.mjs';
import {makeCredentialProvider} from './owner-secret-provider.mjs';import {pinProxy} from './origin-pin.mjs';
export async function runReviewed({ownerApproved=false,privateTmpfsRoot,publishableConfig}){
 if(ownerApproved!==true||!publishableConfig)throw Error('Initial owner approval and synthetic config required');
 const provider=makeCredentialProvider(privateTmpfsRoot);const adapters=reviewedAdapters({ownerApproved,credentialProvider:provider});
 const stop=new AbortController();const cancel=()=>stop.abort();let proxy,restoreAuth;
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 const hard=setTimeout(()=>{proxy?.stop();adapters.destroy();process.exit(70);},3600000);
 try{await orchestrate({...adapters,makeHost:options=>{const h=adapters.makeHost(options);return {...h,connect:async(...args)=>{await h.connect(...args);fs.writeSync(1,'Creator-only preview origin (acceptance unproven): '+proxy.origin+'\n');}};},signal:stop.signal,deadlineMs:3590000,beforeHost:async t=>{const pinPath=savePinReceipt(privateTmpfsRoot,resourcePin(t));restoreAuth=await configureProofAuth(t,privateTmpfsRoot);receipt('AUTH_RECONCILED',t.tunnelId);receipt('PROXY_BIND_STARTED',t.tunnelId);try{proxy=await pinProxy(t,publishableConfig,pinPath);}catch{const e=Error('Private proxy preparation failed');e.code='PROXY_PREPARATION_FAILED';throw e;}},wait:s=>new Promise(resolve=>{if(s.aborted)resolve();else s.addEventListener('abort',resolve,{once:true});})});}
 catch{throw Error('PRIVATE_PREVIEW_FAILED; raw details suppressed');}
 finally{proxy?.stop();clearTimeout(hard);adapters.destroy();await restoreAuth?.();process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
