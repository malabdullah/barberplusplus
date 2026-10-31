import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const state = JSON.parse(await fs.readFile('.cloud-test/credentials.json','utf8'));
const keys = JSON.parse(await fs.readFile('.cloud-test/api-keys.json','utf8'));
const anon = keys.find(key=>key.name==='anon').api_key;
const url = `https://${state.projectRef}.supabase.co`;
const headers = token => ({apikey:anon,Authorization:`Bearer ${token || anon}`,'Content-Type':'application/json'});
const sessions = {};
for (const role of ['admin','manager','agent','barber','manager-two']) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {method:'POST',headers:headers(),body:JSON.stringify({email:`${role}@barber.test`,password:state.staffPassword})});
  const body = await response.json();
  assert.equal(response.status,200,`${role} password login`);
  assert.equal(body.user.app_metadata.role,role.startsWith('manager')?'manager':role);
  sessions[role] = body;
}
const other = '10000000-0000-4000-8000-000000000002';
for (const role of ['manager','barber']) {
  const read = await fetch(`${url}/rest/v1/branches?select=id&id=eq.${other}`, {headers:headers(sessions[role].access_token)});
  assert.equal(read.status,200);assert.deepEqual(await read.json(),[]);
  const write = await fetch(`${url}/rest/v1/branches?id=eq.${other}`, {method:'PATCH',headers:{...headers(sessions[role].access_token),Prefer:'return=representation'},body:JSON.stringify({name:'Forbidden cross-tenant test'})});
  assert.equal(write.status,200);assert.deepEqual(await write.json(),[]);
}
const anonymous = await fetch(`${url}/rest/v1/rpc/customer_booking`, {method:'POST',headers:headers(),body:JSON.stringify({p_action:'catalog',p_data:{}})});
assert.equal(anonymous.status,401);
const mailbox = await fetch(`${url}/rest/v1/rpc/cloud_test_mailbox`, {method:'POST',headers:headers(sessions.manager.access_token),body:JSON.stringify({p_action:'list',p_data:{}})});
assert.equal(mailbox.status,403);
const filename = `branches/10000000-0000-4000-8000-000000000001-${Date.now()}.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const upload = await fetch(`${url}/storage/v1/object/avatars/${filename}`,{method:'POST',headers:{...headers(sessions.manager.access_token),'Content-Type':'image/png'},body:png});
assert.equal(upload.status,200,'manager can upload an owned shop image');
const denied = await fetch(`${url}/storage/v1/object/avatars/branches/${other}-${Date.now()}.png`,{method:'POST',headers:{...headers(sessions.manager.access_token),'Content-Type':'image/png'},body:png});
assert.equal(denied.status,400,'manager cannot upload another tenant image');
const removed = await fetch(`${url}/storage/v1/object/avatars`,{method:'DELETE',headers:headers(sessions.manager.access_token),body:JSON.stringify({prefixes:[filename]})});
assert.equal(removed.status,200);
const initial = await fetch(state.appUrl,{headers:{authorization:`Basic ${btoa(`tester:${state.accessPassword}`)}`}});
assert.equal(initial.status,200);
const cookie = initial.headers.get('set-cookie').split(';')[0];
for (const role of ['admin','manager']) {
  const response = await fetch(`${state.appUrl}/test-api/admin-password-reset`,{method:'POST',headers:{...headers(sessions[role].access_token),cookie,Origin:state.appUrl},body:JSON.stringify({action:'list',page:1})});
  assert.equal(response.status,role==='admin'?200:403,`admin function rejects ${role==='admin'?'no legitimate admin':'manager'}`);
}
const recovery = await fetch(`${url}/auth/v1/recover`,{method:'POST',headers:headers(),body:JSON.stringify({email:'manager@barber.test',redirect_to:`${state.appUrl}/reset-password`})});
assert.equal(recovery.status,200,'recovery email is captured');
const inbox = await fetch(`${state.appUrl}/test-inbox?format=json`,{headers:{cookie}});
assert.equal(inbox.status,200);
const mail = await inbox.json();
assert.ok(mail.some(item=>item.recipient==='manager@barber.test' && item.payload?.email_data?.email_action_type==='recovery'));
const report = {checkedAt:new Date().toISOString(),staffRoles:5,tenantReadWriteDenials:true,anonymousBookingRPCDenied:true,mailboxDeniedToManager:true,ownedStorageUpload:true,crossTenantStorageDenied:true,adminFunctionRoleEnforcement:true,recoveryEmailCaptured:true};
await fs.writeFile('.cloud-test/backend-report.json',JSON.stringify(report,null,2));
console.log(report);
