import os
"""SYNTHETIC config only, no CLI execution or current-config write."""
import importlib.util,tomllib,json
from pathlib import Path
s=importlib.util.spec_from_file_location('a',Path(__file__).with_name('auth-origin.py'));a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
raw=b'''project_id="synthetic"
[api]
port=54321
[auth]
site_url="http://127.0.0.1:5173"
additional_redirect_urls=[
 "http://127.0.0.1:5173/reset-password",
 "http://localhost:5173/accept-invite"
]
enable_signup=false
[auth.email]
enable_confirmations=true
[edge_runtime.secrets]
APP_URL="http://127.0.0.1:5173"
SYNTHETIC="DUMMY_ONLY"
'''
origin='https://opaque-service-assigned-5180.use.devtunnels.ms';results=[]
def test(name,f):
 try:f();results.append({'name':name,'status':'PASS','evidence':'SYNTHETIC config only'})
 except Exception:results.append({'name':name,'status':'FAIL'})
def good():
 out=a.revised(raw,origin);d=tomllib.loads(out.decode());assert d['auth']['site_url']==origin;assert d['edge_runtime']['secrets']['APP_URL']==origin
 assert d['auth']['external_url']==origin+'/auth/v1';assert d['auth']['jwt_issuer']=='http://127.0.0.1:54321/auth/v1'
 assert d['auth']['additional_redirect_urls']==[origin+'/accept-invite',origin+'/reset-password',origin+'/login']
 assert d['auth']['enable_signup']is False and d['auth']['email']['enable_confirmations']is True and d['edge_runtime']['secrets']['SYNTHETIC']=='DUMMY_ONLY'
 assert a.revised(out,origin)==out
 test_raw=raw.replace(b'[auth]\n',b'[auth]\njwt_issuer="synthetic-old-issuer"\n');assert tomllib.loads(a.revised(test_raw,origin).decode())['auth']['jwt_issuer']=='synthetic-old-issuer'
test('exact routing update, multiline array, policy/issuer preserved, idempotent',good)
for invalid in ['http://example.com','https://devtunnels.ms',origin+'/path',origin+':8443/',origin+'/?token=DUMMY',origin+'/#DUMMY','https://alias.devtunnels.ms.evil.example']:
 def denied(invalid=invalid):
  try:a.revised(raw,invalid)
  except ValueError:return
  raise AssertionError()
 test('reject invalid proof origin '+invalid,denied)
# Exercise intended lifecycle through mock command recorder without touching a stack.
def commands():
 calls=[];a.run=lambda args:calls.append(args)or b'';a.reconcile();assert [x[2]for x in calls]==['stop','start'];assert '--frozen'in calls[1];assert not any(x in ['destroy','reset','db']for cmd in calls for x in cmd)
test('MOCK only data-preserving stop/start commands',commands)
print(json.dumps(results,indent=2));raise SystemExit(any(x['status']=='FAIL'for x in results))
