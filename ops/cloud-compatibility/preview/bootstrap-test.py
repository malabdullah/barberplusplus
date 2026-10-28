import os
"""Synthetic parser/cleanup tests; optional REAL LOCAL encrypted storage, never login."""
import copy,importlib.util,json,os,subprocess,sys,tempfile,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('b',Path(__file__).with_name('credential-bootstrap.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
results=[]
def test(name,f):
 try:f();results.append({'name':name,'status':'PASS'})
 except BaseException:results.append({'name':name,'status':'FAIL'})
def rejected(f):
 try:f()
 except Exception:return
 raise AssertionError('expected rejection')
def dummy():return [{'accessToken':'SYNTHETIC_ONLY_'+'x'*32,'expiration':int((time.time()+7200+11644473600)*10000000),'scopes':['read:user','read:org'],'login':'MaLaBdUlLaH','userId':123,'refreshToken':'SYNTHETIC_NEVER_IMPORT'}]
test('MOCK pinned cache array accepted',lambda: b.parse_cache(json.dumps(dummy()).encode()))
for name,change in [('wrong owner',lambda r:r[0].update(login='other-owner')),('multiple identities',lambda r:r.append(r[0])),('extra scopes',lambda r:r[0]['scopes'].append('repo')),('expired FILETIME',lambda r:r[0].update(expiration=1)),('missing expiry',lambda r:r[0].pop('expiration')),('unknown shape',lambda r:r[0].update(unexpected='bad')),('bad token',lambda r:r[0].update(accessToken='bad\nvalue')),('non-GitHub identity',lambda r:r[0].update(login='bad/identity'))]:
 def check(change=change):
  r=dummy();change(r);rejected(lambda:b.parse_cache(json.dumps(r).encode()))
 test('MOCK reject '+name,check)
test('MOCK malformed JSON rejected',lambda:rejected(lambda:b.parse_cache(b'{invalid')))
test('MOCK duplicate fields rejected',lambda:rejected(lambda:b.parse_cache(b'[{"accessToken":"x","accessToken":"y"}]')))
def cleanup():
 with tempfile.TemporaryDirectory(dir='/dev/shm')as d:
  p=Path(d);(p/'cache').write_text('DUMMY');b.erase_state(p);assert not list(p.iterdir())
test('REAL LOCAL RAM dummy cache cleanup',cleanup)
if '--local-store'in sys.argv:
 cfg=json.loads(Path(sys.argv[sys.argv.index('--local-store')+1]).read_text());os.umask(0o077)
 def encrypted():
  root=None
  with b.Profile(cfg)as p:
   root=p.root
   cache=root/'state/devtunnels-tokens-github';cache.write_text(json.dumps(dummy()));cache.chmod(0o600)
   p.import_new_cache();assert not list((root/'state').iterdir())
   result=p.command([cfg['secretTool'],'lookup',*b.ATTRS]);assert result.stdout==dummy()[0]['accessToken'].encode()
   assert b'SYNTHETIC_NEVER_IMPORT'not in result.stdout
   result=p.command([cfg['secretTool'],'clear',*b.ATTRS]);assert result.returncode==0
  assert not root.exists()
 test('REAL LOCAL encrypted dummy import, CLI cache erase, store cleanup',encrypted)
 def invalid():
  root=None
  with b.Profile(cfg)as p:
   root=p.root;cache=root/'state/devtunnels-tokens-github';cache.write_text('{}');cache.chmod(0o600)
   rejected(p.import_new_cache);assert not list((root/'state').iterdir())
  assert not root.exists()
 test('REAL LOCAL malformed import erases cache and store',invalid)
 def storefail():
  bad={**cfg,'secretTool':'/usr/bin/false'}
  with b.Profile(bad)as p:
   cache=p.root/'state/devtunnels-tokens-github';cache.write_text(json.dumps(dummy()));cache.chmod(0o600)
   rejected(p.import_new_cache);assert not list((p.root/'state').iterdir())
 test('REAL LOCAL store error erases RAM cache',storefail)
print(json.dumps(results,indent=2));raise SystemExit(any(x['status']=='FAIL'for x in results))
