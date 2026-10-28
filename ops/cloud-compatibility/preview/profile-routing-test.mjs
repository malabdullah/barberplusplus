import assert from'node:assert/strict';import{validateRouting,loadRouting}from'./profile-routing.mjs';
let checks=0;
for(const[profile,apiPort,frontendPort]of[['test',55321,55173],['staging',56321,56173]]){
 const r={profile,apiPort,frontendPort,publishableKey:'sb_publishable_DUMMY'};
 assert.equal(validateRouting(r,profile).apiPort,apiPort);checks++;
 for(const bad of[{...r,apiPort:54321},{...r,frontendPort:5173},{...r,apiPort:56321,profile:'test'},{...r,frontendPort:80}]){
  if(JSON.stringify(bad)===JSON.stringify(r))continue;assert.throws(()=>validateRouting(bad,profile));checks++;
 }
}
const old=process.env.BARBER_CLOUD_PROFILE;delete process.env.BARBER_CLOUD_PROFILE;assert.throws(()=>loadRouting());checks++;if(old)process.env.BARBER_CLOUD_PROFILE=old;
process.env.BARBER_PROXY_FIXTURE='1';process.env.BARBER_LIVE_APPROVED='1';assert.throws(()=>loadRouting());checks++;delete process.env.BARBER_LIVE_APPROVED;
console.log(JSON.stringify({checks,evidence:'pure routing guards; no requests/login/hosting'}));
