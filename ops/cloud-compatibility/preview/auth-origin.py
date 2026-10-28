import os
"""Proof-only stopped-stack config reconciliation. Default plan only; no DB reset."""
import argparse,hashlib,json,os,re,subprocess,sys,tempfile,tomllib
from urllib.parse import urlsplit
from pathlib import Path
ROOT=Path(os.environ['BARBER_CLOUD_STATE']).resolve();CONFIG=ROOT/'native-stack/supabase/config.toml';CONTROL=Path(__file__).resolve().parents[1]/'runtime/profile.py'
def exact_origin(origin):
 try:
  if not isinstance(origin,str)or len(origin)>2048:raise ValueError()
  u=urlsplit(origin);host=u.hostname or '';labels=host.split('.')
  if u.scheme!='https' or u.port not in [None,443]or u.path not in ['', '/']or u.username is not None or u.password is not None or '?'in origin or '#'in origin or not host.endswith('.devtunnels.ms')or len(host)>253 or len(labels)<3 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label)for label in labels):raise ValueError()
  return 'https://'+host
 except Exception:raise ValueError('Invalid pinned service origin')
def read_origin_pin(root,resource_id,expected_origin=None):
 fd=os.open(root/'origin-pin.json',os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  st=os.fstat(f.fileno())
  if st.st_uid!=os.getuid()or st.st_mode&0o777!=0o600 or st.st_nlink!=1 or st.st_size>4096:raise ValueError('Invalid origin pin receipt')
  data=json.load(f)
 fields={'schema','controlOrigin','resourceId','clusterId','portNumber','endpointId','hostId','hostKeySha256','origin','pinnedAt'}
 if set(data)!=fields or data['schema']!=1 or data['controlOrigin']!='https://use.rel.tunnels.api.visualstudio.com'or data['resourceId']!=resource_id or not re.fullmatch(r'barber-[0-9a-f]{24}',resource_id or '')or data['clusterId']!='use'or data['portNumber']!=5180 or any(not isinstance(data[k],str)or not re.fullmatch(r'[A-Za-z0-9._-]{1,200}',data[k])for k in ['endpointId','hostId'])or not re.fullmatch(r'[0-9a-f]{64}',data['hostKeySha256'])or exact_origin(data['origin'])!=data['origin']:raise ValueError('Invalid origin pin receipt')
 if expected_origin is not None and expected_origin!=data['origin']:raise ValueError('Origin differs from single resource pin')
 return data
def set_field(text,section,key,value):
 pattern=re.compile(r'(?m)^\['+re.escape(section)+r'\][ \t]*(?:#.*)?$');matches=list(pattern.finditer(text))
 if len(matches)!=1:raise ValueError('Required unique proof config section missing')
 a=matches[0].end();next_section=re.search(r'(?m)^\[',text[a:]);b=a+next_section.start()if next_section else len(text)
 block=text[a:b];line=re.compile(r'(?ms)^'+re.escape(key)+r'\s*=.*?(?=^[A-Za-z_][A-Za-z0-9_-]*\s*=|\Z)');found=list(line.finditer(block))
 if len(found)>1:raise ValueError('Duplicate config field')
 assignment=key+' = '+json.dumps(value)
 block=line.sub(lambda _:assignment+'\n',block,count=1)if found else '\n'+assignment+block
 return text[:a]+block+text[b:]
def revised(raw,origin):
 origin=exact_origin(origin);text=raw.decode();d=tomllib.loads(text);auth=d['auth'];api=d['api']
 # Pin old issuer so changing external verification-link routing does not invalidate sessions.
 old_external=auth.get('external_url')or api.get('external_url',f"http://127.0.0.1:{api['port']}").rstrip('/')+'/auth/v1'
 issuer=auth.get('jwt_issuer')or old_external
 for section,key,value in [('auth','site_url',origin),('auth','additional_redirect_urls',[origin+'/accept-invite',origin+'/reset-password',origin+'/login']),('auth','external_url',origin+'/auth/v1'),('auth','jwt_issuer',issuer),('edge_runtime.secrets','APP_URL',origin)]:text=set_field(text,section,key,value)
 after=tomllib.loads(text)
 # Every non-routing config field, including all policy/secrets, must remain identical.
 before=tomllib.loads(raw.decode());compare=tomllib.loads(text)
 for k in ['site_url','additional_redirect_urls','external_url','jwt_issuer']:
  if k in before['auth']:compare['auth'][k]=before['auth'][k]
  else:compare['auth'].pop(k,None)
 compare['edge_runtime']['secrets']['APP_URL']=before['edge_runtime']['secrets']['APP_URL']
 if compare!=before:raise ValueError('Unexpected non-routing configuration difference')
 return text.encode()
def run(args):
 p=subprocess.run(args,capture_output=True,timeout=180)
 if p.returncode:raise RuntimeError('Proof native control failed; private output suppressed')
 return p.stdout
def owned_profile():
 sys.path.insert(0,str(CONTROL.parent))
 import profile
 name=os.environ.get('BARBER_CLOUD_PROFILE')
 if name not in profile.PROFILES or profile.checked_root(name)!=ROOT:raise RuntimeError('Owned cloud profile required')
 profile.context(name)
 return profile,name

def snapshot():
 profile,name=owned_profile()
 d=profile.baseline(name)
 if d['cron']!='off':raise RuntimeError('Cron must remain disabled')
 # Data hashes stay private; never serialize rows or credential contents.
 tables=json.loads(profile.db(name,"SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public'"))
 hashes={}
 for table in tables:
  ident='"'+table.replace('"','""')+'"'
  hashes[table]=profile.db(name,"SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) FROM public."+ident+' t').strip()
 d['public_data_hash']=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()
 d['profile_nonce']=profile.private_json(ROOT/'profile.json')['nonce']
 return d
def atomic(raw):
 fd,name=tempfile.mkstemp(prefix='.preview-routing-',dir=CONFIG.parent)
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,'wb')as f:f.write(raw)
  os.replace(name,CONFIG)
 finally:
  if os.path.exists(name):os.unlink(name)
def reconcile():
 # restart and start on a running stack ignore config; stopped-stack start reads it.
 run([sys.executable,str(CONTROL),'stop',os.environ['BARBER_CLOUD_PROFILE']])
 run([sys.executable,str(CONTROL),'start',os.environ['BARBER_CLOUD_PROFILE']])
def recovery_dir(resource_id):
 if not re.fullmatch(r'barber-[0-9a-f]{24}',resource_id or ''):raise ValueError('New resource ID required')
 return ROOT/'routing-recovery'/resource_id

def write_private(p,raw):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())

def persist_recovery(resource_id,old,new):
 directory=recovery_dir(resource_id)
 directory.mkdir(parents=True,mode=0o700,exist_ok=False)
 directory.parent.chmod(0o700)
 write_private(directory/'original-config',old)
 write_private(directory/'receipt.json',json.dumps({'schema':1,'resourceId':resource_id,'originalSha256':hashlib.sha256(old).hexdigest(),'appliedSha256':hashlib.sha256(new).hexdigest(),'profileNonce':snapshot()['profile_nonce']}).encode())
 return directory

def restore_recovery(resource_id):
 directory=recovery_dir(resource_id)
 if directory.is_symlink()or directory.parent.is_symlink():raise ValueError('Recovery path symlink')
 for p in [directory,directory.parent]:
  st=p.stat()
  if st.st_uid!=os.getuid()or st.st_mode&0o777!=0o700:raise ValueError('Recovery ownership')
 for p in [directory/'receipt.json',directory/'original-config']:
  st=p.lstat()
  if p.is_symlink()or st.st_uid!=os.getuid()or st.st_mode&0o777!=0o600 or st.st_nlink!=1:raise ValueError('Recovery file guard')
 d=json.loads((directory/'receipt.json').read_bytes());original=(directory/'original-config').read_bytes();before=snapshot()
 if d.get('schema')!=1 or d.get('resourceId')!=resource_id or d.get('profileNonce')!=before['profile_nonce']or hashlib.sha256(original).hexdigest()!=d.get('originalSha256'):raise ValueError('Recovery binding mismatch')
 if hashlib.sha256(CONFIG.read_bytes()).hexdigest()not in [d['originalSha256'],d['appliedSha256']]:raise ValueError('Concurrent config change; refuse overwrite')
 atomic(original);reconcile()
 if snapshot()!=before:raise RuntimeError('Routing restore data changed')
 (directory/'original-config').unlink();(directory/'receipt.json').unlink();directory.rmdir()
 return True

def apply_routing(origin,resource_id):
 before=snapshot();old=CONFIG.read_bytes();new=revised(old,origin)
 persist_recovery(resource_id,old,new)
 try:
  atomic(new);reconcile()
  if snapshot()!=before:raise RuntimeError('Routing apply data changed')
 except BaseException:
  try:restore_recovery(resource_id)
  except BaseException:pass # Durable config-only recovery survives RAM erasure.
  raise

def main():
 a=argparse.ArgumentParser();a.add_argument('mode',choices=['plan','apply','restore','recover'],nargs='?',default='plan');a.add_argument('--origin');a.add_argument('--resource-id');a.add_argument('--receipt-dir');a.add_argument('--owner-approved',action='store_true');args=a.parse_args()
 if args.mode=='plan':print(json.dumps({'mode':'PLAN ONLY','data_preserving':True,'durable_recovery':'owned profile routing-recovery/new-resource-id; config only, no OAuth/cache','reset':False}));return
 if not args.owner_approved:raise ValueError('Initial owner approval required')
 owned_profile()
 route_keys={'SUPABASE_AUTH_SITE_URL','SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS','SUPABASE_AUTH_JWT_ISSUER','SUPABASE_API_EXTERNAL_URL'}
 synthetic=json.loads((ROOT/'synthetic-secrets.json').read_text())
 if route_keys.intersection(os.environ)or route_keys.intersection(synthetic):raise ValueError('Ambiguous routing overrides')
 if args.mode=='recover':restore_recovery(args.resource_id)
 else:
  p=Path(args.receipt_dir).resolve();st=p.stat()
  if not str(p).startswith('/dev/shm/barber-owner-')or st.st_uid!=os.getuid()or st.st_mode&0o777!=0o700:raise ValueError('Private RAM root required')
  ref=p/'routing-recovery-reference.json'
  if args.mode=='apply':
   pin=read_origin_pin(p,args.resource_id,args.origin)
   write_private(ref,json.dumps({'resourceId':pin['resourceId']}).encode())
   apply_routing(pin['origin'],pin['resourceId'])
  else:
   if ref.is_symlink():raise ValueError('RAM reference symlink')
   resource_id=json.loads(ref.read_text())['resourceId'];restore_recovery(resource_id);ref.unlink()
 print('Proof Auth routing reconciled; current owned-profile data preserved')
if __name__=='__main__':
 try:main()
 except BaseException:print('Proof Auth routing failed; private details suppressed',file=sys.stderr);raise SystemExit(1)
