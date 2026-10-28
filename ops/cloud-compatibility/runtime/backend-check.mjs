import fs from'node:fs';import{root,env,client}from'./context.mjs';
const checks=[],clients={},booking='50000000-0000-4000-8000-000000000001',own='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',marker='CLOUD_CANDIDATE_'+Date.now(),object=marker+'.txt';let original,uploaded=false;const svc=client(env.SECRET_KEY);
function check(name,ok){checks.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);}
try{
 for(const role of['admin','manager','agent','barber','manager-two']){
  const c=client();clients[role]=c;const{data,error}=await c.auth.signInWithPassword({email:role+'@barber.test',password:'LocalOnly123!'});check(role+' login',!error&&data.user?.app_metadata?.role===(role==='manager-two'?'manager':role));const r=await c.auth.refreshSession();check(role+' refresh',!r.error&&!!r.data.session);
 }
 for(const role of['manager','barber','manager-two'])for(const[id,count,label]of[[role==='manager-two'?other:own,1,'own branch'],[role==='manager-two'?own:other,0,'cross branch']]){
  const r=await clients[role].from('branches').select('id').eq('id',id);check(role+' '+label,!r.error&&r.data?.length===count);
 }
 const r=await clients.manager.from('bookings').select('notes').eq('id',booking).single();check('read seeded booking',!r.error);original=r.data.notes;
 const w=await clients.manager.from('bookings').update({notes:marker}).eq('id',booking).select('notes');check('authorized REST write',!w.error&&w.data?.[0]?.notes===marker);
 for(const action of['read','write']){const q=clients['manager-two'].from('bookings');const r=await(action==='read'?q.select('id'):q.update({notes:'DENIED'}).select('id')).eq('id',booking);check('tenant owner '+action+' denied',!r.error&&r.data?.length===0);}
 const bucket='cloud-candidate-private';const b=await svc.storage.createBucket(bucket,{public:false});check('private bucket',!b.error||b.error.message.includes('already exists'));
 const bytes='Synthetic candidate storage';const u=await svc.storage.from(bucket).upload(object,bytes,{contentType:'text/plain'});check('actual Storage upload',!u.error);uploaded=true;
 const d=await svc.storage.from(bucket).download(object);check('actual Storage bytes',!d.error&&await d.data.text()===bytes);
 check('private Storage cross-tenant denial',!!(await clients['manager-two'].storage.from(bucket).download(object)).error);
 check('browser Storage upload denial without invented policy',!!(await clients.manager.storage.from(bucket).upload('unauthorized-'+object,bytes)).error);
}catch{process.exitCode=1;}
finally{
 if(original!==undefined){const r=await clients.manager.from('bookings').update({notes:original}).eq('id',booking).eq('notes',marker).select('id');checks.push({name:'conditional exact note restoration',status:!r.error&&r.data?.length===1?'PASS':'FAIL'});}
 if(uploaded){const r=await svc.storage.from('cloud-candidate-private').remove([object]);checks.push({name:'own object cleanup',status:!r.error?'PASS':'FAIL'});}
 for(const[role,c]of Object.entries(clients)){const r=await c.auth.signOut({scope:'local'});checks.push({name:role+' local logout',status:!r.error?'PASS':'FAIL'});}
 fs.writeFileSync(root+'/results/backend.json',JSON.stringify(checks,null,2));console.log(JSON.stringify({checks:checks.length,failed:checks.filter(x=>x.status!=='PASS').length}));if(checks.some(x=>x.status!=='PASS'))process.exitCode=1;
}
