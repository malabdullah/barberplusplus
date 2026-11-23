import { test } from 'node:test';import assert from 'node:assert/strict';import { execFileSync } from 'node:child_process';
test('read-only production metadata emits only selected non-secret settings and exact image IDs',()=>{
 const program=`import importlib.util,json
spec=importlib.util.spec_from_file_location('probe','ops/account-deletion/inspect-runtime.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
names=p.NAMES
records=[{'Name':'/'+n,'Image':'sha256:'+'a'*64,'State':{'Running':True,'Health':{'Status':'healthy'}},'Config':{'Env':['APP_ENV=production','APP_URL=https://www.barberplusplus.com','SUPABASE_SERVICE_ROLE_KEY=never-output-service-key','RESEND_API_KEY=never-output-mail-key','UNRELATED_SECRET=never-output-unrelated']}}for n in names]
lock={'containers':{n:{'imageId':'sha256:'+'a'*64}for n in names}}
print(json.dumps(p.summarize(records,lock)))
`;
 const raw=execFileSync('python3',['-c',program],{encoding:'utf8'});assert.ok(!raw.includes('never-output'));const value=JSON.parse(raw);assert.equal(value.readOnly,true);assert.equal(value.exactImageMatches,true);assert.equal(value.functions.secretPresent.RESEND_API_KEY,true);assert.equal(value.functions.configuration.CUSTOMER_ACCOUNT_DELETION_ENABLED,'');
});
test('the pinned-runtime rehearsal requires the exact default-disabled deletion response',()=>{
 const program=`from pathlib import Path
s=Path('ops/release/test-functions-image.py').read_text()
assert "name === 'customer-account-deletion' ? [503]"in s
assert "result.closedError !== 'NOT_ENABLED'"in s
assert 'closedError:closed.error'in s
assert "'--network', 'none'" in s
print('closed state assertion installed')
`;
 assert.match(execFileSync('python3',['-c',program],{encoding:'utf8'}),/closed state assertion installed/);
});
