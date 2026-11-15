import { createDeletionCleanup } from './cleanup.ts';
const same = (a: unknown,b: unknown) => { if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Assertion failed'); };
const job = {id:'job',lease:'lease',appleTasks:[{id:'task',cipher:'private-envelope'}],objects:[{bucket:'owned',name:'target/file'}],userIds:['target']};
function setup(failure='') {
  const calls: unknown[]=[];
  const run=createDeletionCleanup({rpc:async(action,data)=>{calls.push([action,data]);if(action==='claim')return failure==='no-job'?null:job;if(action==='apple-complete')return failure!=='stale';if(action==='finish'&&failure==='unfinished')throw Error('CLEANUP_PENDING');return{};},
    revoke:async()=>{calls.push('revoke');if(failure==='provider')throw Error('provider private-token');},
    remove:async(bucket,names)=>{calls.push(['storage',bucket,names]);return{error:failure==='storage'?{}:null};},
    deleteUser:async(id)=>{calls.push(['auth',id]);return{error:failure==='auth'?{status:500}:failure==='missing-auth'?{status:404}:null};},warn:()=>calls.push('safe-warning')});
  return{calls,run};
}
Deno.test('provider acknowledgement precedes Storage/Auth deletion; cleanup stays scoped to its leased account',async()=>{
  const{calls,run}=setup();await run('job');same(calls,[['claim',{id:'job'}],'revoke',['apple-complete',{id:'job',lease:'lease',task:'task'}],['storage','owned',['target/file']],['auth','target'],['finish',{id:'job',lease:'lease'}]]);
});
Deno.test('provider failure or stale acknowledgement cannot remove Auth or falsely finish; only same lease retries',async()=>{
  for(const failure of ['provider','stale','storage','auth','unfinished']){
    const{calls,run}=setup(failure);await run('job');same(calls.slice(-2),[['retry',{id:'job',lease:'lease'}],'safe-warning']);
    if(['provider','stale'].includes(failure))same(calls.some(x=>Array.isArray(x)&&x[0]==='auth'),false);
  }
});
Deno.test('duplicate absent Auth is safe; no claim performs no provider or account operation',async()=>{
  const a=setup('missing-auth');await a.run('job');same(a.calls.at(-1),['finish',{id:'job',lease:'lease'}]);
  const b=setup('no-job');await b.run('job');same(b.calls,[['claim',{id:'job'}]]);
});
