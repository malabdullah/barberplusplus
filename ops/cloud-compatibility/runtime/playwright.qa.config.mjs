import{execFileSync}from'node:child_process';
const profile=process.env.BARBER_CLOUD_PROFILE||'test';if(!['test','staging'].includes(profile))throw Error('PROFILE_ALLOWLIST');
const r=JSON.parse(execFileSync('python3',[new URL('./export-route.py',import.meta.url).pathname,profile],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
process.env.VITE_SUPABASE_PUBLISHABLE_KEY=r.publishableKey;process.env.BARBER_QA_API='http://127.0.0.1:'+r.apiPort;
const state='/workspace/barber-cloud-candidate-state/'+profile;
export default {
 testDir:profile==='staging'?state+'/source/tests/e2e':'../../../tests/e2e',outputDir:state+'/browser-results',
 workers:1,retries:0,timeout:30000,reporter:[['list'],['json',{outputFile:state+'/results/e2e.json'}]],
 use:{baseURL:'http://127.0.0.1:'+r.frontendPort,browserName:'chromium',launchOptions:{executablePath:'/usr/bin/chromium'},trace:'off'}
};
