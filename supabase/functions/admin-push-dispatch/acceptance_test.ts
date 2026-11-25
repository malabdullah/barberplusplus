import assert from 'node:assert/strict';
import { createAndroidAcceptanceDispatcher } from './acceptance.ts';
import type { AnnouncementJob } from './delivery.ts';
const secret = 'd'.repeat(64);
const job: AnnouncementJob = { id: crypto.randomUUID(), lease: crypto.randomUUID(), campaignId: crypto.randomUUID(), recipientBinding: 'a'.repeat(64),
  client: 'android', environment: 'production', deliveryMode: 'apns', projectId: 'barber-plus-plus-phone-prod', packageName: 'com.barberplusplus.customer',
  token: 'synthetic-token-for-acceptance', topic: '', language: 'en', titleEn: 'Barber++', bodyEn: 'Test', titleAr: '', bodyAr: '', destination: 'book', expiresAt: Date.now() / 1000 + 600 };
const sender = 'acceptance-qa@barber-plus-plus-phone-prod.iam.gserviceaccount.com';
const config = { enabled: true, dispatchSecret: secret, apiUrl: 'https://srv1073968.hstgr.cloud', projectId: job.projectId!, packageName: job.packageName!, senderEmail: sender,
  credential: { type: 'service_account', project_id: job.projectId!, client_email: sender, private_key_id: 'a'.repeat(40), private_key: '-----BEGIN PRIVATE KEY-----synthetic', token_uri: 'https://oauth2.googleapis.com/token' } };
function fixture() {
  const counts = { claim: 0, token: 0, send: 0, finish: 0 };
  const deps = { environment: 'production', enabled: true, configuration: async () => config,
    claim: async () => { counts.claim++; return [job]; }, validate: async () => true,
    finish: async (_: AnnouncementJob, __: {status:number}) => { counts.finish++; },
    token: async () => { counts.token++; return 'synthetic'; }, send: async () => { counts.send++; return {status:200,reason:'',providerId:'synthetic'}; } };
  return { counts, deps };
}
const request = () => new Request('https://srv1073968.hstgr.cloud/functions/v1/admin-push-dispatch', { method: 'POST', headers: {'x-push-secret':secret} });
Deno.test('acceptance uses one validated job and one provider call without generic continuation', async () => {
  const {deps,counts}=fixture();const result=await createAndroidAcceptanceDispatcher(deps)(request());
  assert.deepEqual(await result.json(),{claimed:1,accepted:1});assert.deepEqual(counts,{claim:1,token:1,send:1,finish:1});
});
Deno.test('acceptance remains disabled by default and rejects Test as Live', async () => {
  for (const change of [{enabled:false},{environment:'cloud-test'}]) {
    const {deps,counts}=fixture();assert.equal((await createAndroidAcceptanceDispatcher({...deps,...change})(request())).status,403);
    assert.equal(counts.claim,0);assert.equal(counts.send,0);
  }
});
Deno.test('acceptance rejects foreign configuration and secret before claiming', async () => {
  for (const change of [{apiUrl:'https://wrong.test'},{projectId:'wrong'},{dispatchSecret:'e'.repeat(64)},{enabled:false}]) {
    const {deps,counts}=fixture();const response=await createAndroidAcceptanceDispatcher({...deps,configuration:async()=>({...config,...change})})(request());
    assert.ok(response.status>=400);assert.equal(counts.claim,0);
  }
});
Deno.test('acceptance fails closed on multiple jobs, iOS or a foreign Android app', async () => {
  for (const jobs of [[job,job],[{...job,client:'ios'}],[{...job,packageName:'wrong.app'}]]) {
    const {deps,counts}=fixture();await createAndroidAcceptanceDispatcher({...deps,claim:async()=>jobs})(request());
    assert.equal(counts.token,0);assert.equal(counts.send,0);
  }
});
Deno.test('acceptance revalidates after token creation and cancels when eligibility changed', async () => {
  const {deps,counts}=fixture();let checks=0;
  await createAndroidAcceptanceDispatcher({...deps,validate:async()=>++checks===1})(request());
  assert.equal(counts.token,1);assert.equal(counts.send,0);assert.equal(counts.finish,1);
});
Deno.test('acceptance never retries uncertain provider delivery', async () => {
  const {deps,counts}=fixture();let status=-1;
  await createAndroidAcceptanceDispatcher({...deps,send:async()=>{counts.send++;throw Error('synthetic timeout');},finish:async(_,r)=>{counts.finish++;status=r.status;}})(request());
  assert.equal(counts.send,1);assert.equal(counts.finish,1);assert.equal(status,0);
});
