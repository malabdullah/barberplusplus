import {execFile}from'node:child_process';import{promisify}from'node:util';import{assignedOrigin}from'./origin-pin.mjs';
const run=promisify(execFile);const script=new URL('./auth-origin.py',import.meta.url).pathname;
export async function configureProofAuth(t,root){const origin=assignedOrigin(t);try{await run('python3',[script,'apply','--owner-approved','--origin',origin,'--resource-id',t.tunnelId,'--receipt-dir',root],{timeout:380000,maxBuffer:8192});}catch{const e=Error('Proof Auth reconciliation failed');e.code='AUTH_RECONCILE_FAILED';throw e;}
 return async()=>{try{await run('python3',[script,'restore','--owner-approved','--receipt-dir',root],{timeout:380000,maxBuffer:8192});}catch{throw Error('Proof Auth restoration failed');}};
}
