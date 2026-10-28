import fs from'node:fs';import crypto from'node:crypto';import{createRequire}from'node:module';
const{createClient}=createRequire(new URL('../../../package.json',import.meta.url))('@supabase/supabase-js');
const base='/workspace/barber-cloud-candidate-state',records=Object.fromEntries(['test','staging'].map(n=>[n,JSON.parse(fs.readFileSync(`${base}/${n}/status-private.json`)).env]));const results=[],clients={},services={};
const id='50000000-0000-4000-8000-000000000001',marker='CROSS_PROFILE_'+crypto.randomUUID(),object=marker+'.txt';let original;const uploaded=[];
const check=(name,ok)=>{results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error('ISOLATION_ASSERTION');};
try{
 check('separate API ports',records.test.API_URL==='http://127.0.0.1:55321'&&records.staging.API_URL==='http://127.0.0.1:56321');
 for(const key of['PUBLISHABLE_KEY','SECRET_KEY'])check('independent '+key,records.test[key]!==records.staging[key]);
 const keys=['test','staging'].map(n=>JSON.parse(fs.readFileSync(`${base}/${n}/native-stack/supabase/keys.json`))[0]);check('independent ES256 signing keys',keys[0].kid!==keys[1].kid&&keys[0].x!==keys[1].x);
 const secrets=['test','staging'].map(n=>JSON.parse(fs.readFileSync(`${base}/${n}/synthetic-secrets.json`)));check('independent HS JWT and job secrets',secrets[0].SUPABASE_AUTH_JWT_SECRET!==secrets[1].SUPABASE_AUTH_JWT_SECRET&&secrets[0].CLOUD_CRON_SHARED_SECRET!==secrets[1].CLOUD_CRON_SHARED_SECRET);
 const tokens={};for(const name of['test','staging']){const e=records[name],c=createClient(e.API_URL,e.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});clients[name]=c;services[name]=createClient(e.API_URL,e.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const r=await c.auth.signInWithPassword({email:'manager@barber.test',password:'LocalOnly123!'});check(name+' positive Auth login',!r.error&&!!r.data.session);tokens[name]=r.data.session.access_token;const read=await c.from('bookings').select('notes').eq('id',id).single();check(name+' positive REST read',!read.error);if(name==='test')original=read.data.notes;}
 for(const[from,to]of[['test','staging'],['staging','test']]){
  const e=records[to];const r=await fetch(e.API_URL+'/rest/v1/bookings?select=id',{headers:{apikey:e.PUBLISHABLE_KEY,Authorization:'Bearer '+tokens[from]}});check(from+' JWT rejected by '+to,[401,403].includes(r.status));
  const k=await fetch(e.API_URL+'/rest/v1/bookings?select=id',{headers:{apikey:records[from].PUBLISHABLE_KEY}});check(from+' API key rejected by '+to,k.status===401);
 }
 const before=await clients.staging.from('bookings').select('notes').eq('id',id).single();const w=await clients.test.from('bookings').update({notes:marker}).eq('id',id).select('notes');check('Test-only data write',!w.error&&w.data?.[0]?.notes===marker);const after=await clients.staging.from('bookings').select('notes').eq('id',id).single();check('Staging data unaffected by Test write',!after.error&&after.data.notes===before.data.notes&&after.data.notes!==marker);
 for(const name of['test','staging']){const b=services[name].storage.from('cloud-candidate-private'),payload='SYNTHETIC_'+name;const u=await b.upload(object,payload,{contentType:'text/plain'});check(name+' isolated Storage upload',!u.error);uploaded.push(name);const d=await b.download(object);check(name+' same object name returns own bytes',!d.error&&await d.data.text()===payload);}
 check('distinct native data/cache/upload roots',fs.realpathSync(base+'/test/native-home')!==fs.realpathSync(base+'/staging/native-home')&&!fs.lstatSync(base+'/test/native-home/cache').isSymbolicLink()&&!fs.lstatSync(base+'/staging/native-home/cache').isSymbolicLink());
}catch{process.exitCode=1;}
finally{
 if(original!==undefined&&clients.test){const r=await clients.test.from('bookings').update({notes:original}).eq('id',id).eq('notes',marker).select('id');check('Test notes restored conditionally',!r.error&&r.data?.length===1);}
 for(const n of uploaded){const r=await services[n].storage.from('cloud-candidate-private').remove([object]);check(n+' own object cleanup',!r.error);}
 for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});
 fs.writeFileSync(base+'/isolation-result.json',JSON.stringify({result:results.every(r=>r.status==='PASS')?'PASS':'FAIL',checks:results},null,2));console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>r.status!=='PASS').length}));
}
