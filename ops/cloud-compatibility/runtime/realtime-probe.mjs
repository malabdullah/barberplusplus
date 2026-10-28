import fs from 'node:fs';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import{root,env as old,createClient}from'./context.mjs';
const run=promisify(execFile),out=root+'/results',label='strict-realtime-'+Date.now();
const report={label,started:new Date().toISOString(),events:[],checks:[]};const begin=Date.now();
const event=(type,detail)=>{const e={ms:Date.now()-begin,type,...detail};report.events.push(e);console.log(JSON.stringify(e));};
const check=(name,ok,detail={})=>{report.checks.push({name,status:ok?'PASS':'FAIL',...detail});event('check',report.checks.at(-1));if(!ok)throw Error(name);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const physical={created:0,closed:0,heartbeatSent:0,heartbeatAck:0,sockets:[]};
class MeasuredWebSocket extends WebSocket{constructor(...a){super(...a);this.proofStats={sent:0,ack:0,refs:new Set()};physical.sockets.push(this.proofStats);physical.created++;this.addEventListener('close',()=>physical.closed++);this.addEventListener('message',e=>{try{const p=JSON.parse(e.data);if(p.event==='phx_reply'&&p.topic==='phoenix'&&this.proofStats.refs.has(p.ref)&&p.payload?.status==='ok'){this.proofStats.refs.delete(p.ref);this.proofStats.ack++;physical.heartbeatAck++;}}catch{}});}send(data){try{const p=JSON.parse(data);if(p.event==='heartbeat'&&p.topic==='phoenix'){physical.heartbeatSent++;this.proofStats.sent++;this.proofStats.refs.add(p.ref);}}catch{}return super.send(data);}}
const clients=[],channels=[],received=[[],[]],systems=[[],[]],states=[[],[]],sessions=[];
const users=['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005'];
async function db(){const q=`SELECT coalesce(json_agg(json_build_object('id',id,'subscription_id',subscription_id,'sub',claims->>'sub','session_id',claims->>'session_id','entity',entity::text,'filters',filters::text,'action',action_filter)), '[]'::json) FROM realtime.subscription WHERE entity='public.bookings'::regclass AND claims->>'sub' IN ('${users.join("','")}');`;return JSON.parse((await run('python3',[new URL('./psql.py',import.meta.url).pathname,'-Atc',q],{timeout:5000})).stdout);}
let marker,original;
try{
 const cleanupDeadline=Date.now()+15000;let previous=[];do{previous=await db();if(!previous.length)break;await wait(250);}while(Date.now()<cleanupDeadline);check('no prior probe subscriptions remain',previous.length===0,{rows:previous.length});
 for(const[i,role]of['manager','manager-two'].entries()){
  const c=createClient(old.API_URL,old.PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{timeout:30000,transport:MeasuredWebSocket}});clients.push(c);
  const{data,error}=await c.auth.signInWithPassword({email:role+'@barber.test',password:'LocalOnly123!'});if(error)throw error;
  sessions[i]=JSON.parse(Buffer.from(data.session.access_token.split('.')[1],'base64url').toString()).session_id;
  await c.realtime.setAuth(data.session.access_token);
  const ch=c.channel('proof-'+label+'-'+i+'-'+Date.now()).on('system',{},p=>{const safe={status:p.status,message:p.message,extension:p.extension};systems[i].push(safe);event('system',{role,...safe});}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'bookings',filter:'id=eq.50000000-0000-4000-8000-000000000001'},p=>{received[i].push(p);event('change',{role,id:p.new.id,markerMatched:p.new.notes===marker});});channels.push(ch);
  ch.subscribe((s,error)=>{states[i].push(s);event('channel',{role,status:s,error:error?.message,bindings:ch.bindings?.postgres_changes?.map(b=>({id:b.id,filter:b.filter}))});});
  const registrationDeadline=Date.now()+30000;let registered=false;
  while(Date.now()<registrationDeadline){
   if(states[i].includes('CHANNEL_ERROR')||states[i].includes('TIMED_OUT'))throw Error(role+' channel failed during tenant initialization');
   const rows=await db();
   if(ch.state==='joined'&&systems[i].some(p=>p.status==='ok'&&p.extension==='postgres_changes')&&rows.some(r=>r.sub===users[i]&&r.session_id===sessions[i]&&r.filters.includes('50000000-0000-4000-8000-000000000001'))){event('role-ready',{role,rows:rows.filter(r=>r.sub===users[i])});registered=true;break;}
   await wait(250);
  }
  check(role+' database/system registration barrier',registered);
 }
 const deadline=Date.now()+45000;let ready=false,last='',stableSince;
 while(Date.now()<deadline){
  if(states.some(x=>x.includes('CHANNEL_ERROR')||x.includes('TIMED_OUT')))throw Error('Channel failed before database registration');
  const rows=await db(),signature=JSON.stringify(rows);
  if(signature!==last){event('database-registration',{rows});last=signature;}
  const both=users.every((sub,index)=>rows.some(r=>r.sub===sub&&r.session_id===sessions[index]&&r.filters.includes('50000000-0000-4000-8000-000000000001')))&&channels.every(c=>c.state==='joined');
  if(both){stableSince??=Date.now();if(Date.now()-stableSince>=1000){ready=true;report.readyRows=rows;break;}}else stableSince=undefined;
  await wait(250);
 }
 check('both authenticated subscriptions registered in database and live',ready,{waitMs:Date.now()-begin});
 {const r=await clients[0].from('bookings').select('notes').eq('id','50000000-0000-4000-8000-000000000001').single();if(r.error)throw Error('Original note read failed');original=r.data.notes;}
 const hold=Number(process.env.BARBER_RT_HOLD_MS||0);if(hold){check('bounded held interval configured',hold>=70000&&hold<=75000);const before={created:physical.created,closed:physical.closed,acks:physical.heartbeatAck},held=Date.now();await wait(hold);const rows=await db();check('same two physical sockets held over70s',Date.now()-held>=70000&&physical.created===before.created&&physical.closed===before.closed&&physical.created===2);check('both subscriptions live after held idle',users.every((sub,i)=>rows.some(r=>r.sub===sub&&r.session_id===sessions[i]))&&channels.every(c=>c.state==='joined'));check('held heartbeat acknowledgements',physical.heartbeatAck-before.acks>=4&&physical.sockets.every(s=>s.ack>=2));report.held={elapsedMs:Date.now()-held,socketsCreated:physical.created,socketsClosed:physical.closed,heartbeatSent:physical.heartbeatSent,heartbeatAck:physical.heartbeatAck};}
 marker='Synthetic registered realtime '+label+' '+Date.now();
 const{data,error}=await clients[0].from('bookings').update({notes:marker}).eq('id','50000000-0000-4000-8000-000000000001').select('id,notes');
 check('authorized write committed',!error&&data?.[0]?.notes===marker,{error:error?.message});
 const deliveryDeadline=Date.now()+12000;while(Date.now()<deliveryDeadline&&!received[0].some(p=>p.new.notes===marker))await wait(100);
 check('authorized UPDATE delivered',received[0].some(p=>p.new.notes===marker));
 const denialEnd=Date.now()+5000;while(Date.now()<denialEnd){if(received[1].length)break;await wait(100);}
 const finalRows=await db();check('denied subscriber stays registered and joined during positive control',finalRows.some(r=>r.sub===users[1]&&r.session_id===sessions[1])&&channels[1].state==='joined'&&!states[1].some(s=>s!=='SUBSCRIBED'),{state:channels[1].state,rows:finalRows.filter(r=>r.sub===users[1]).length});
 check('cross-tenant receives zero changes',received[1].length===0,{received:received[1].length});
 report.finalRows=finalRows;report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.message;event('failure',{message:error.message});process.exitCode=1;}
finally{if(original!==undefined){const r=await clients[0].from('bookings').update({notes:original}).eq('id','50000000-0000-4000-8000-000000000001').eq('notes',marker).select('id');report.noteRestoration=!r.error&&r.data?.length===1;if(!report.noteRestoration)process.exitCode=1;}for(const c of clients){await c.removeAllChannels();await c.auth.signOut({scope:'local'});}const until=Date.now()+15000;let remaining=[];do{remaining=(await db()).filter(r=>sessions.includes(r.session_id));if(!remaining.length)break;await wait(250);}while(Date.now()<until);report.cleanup={rows:remaining.length,channelsClosed:channels.every(c=>c.state==='closed')};event('cleanup',report.cleanup);if(remaining.length||!report.cleanup.channelsClosed){report.result='FAIL';report.error='Probe socket/database cleanup incomplete';process.exitCode=1;}report.finished=new Date().toISOString();fs.writeFileSync(out+'/'+label+'.json',JSON.stringify(report,null,2));}
