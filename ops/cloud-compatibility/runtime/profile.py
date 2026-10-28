#!/usr/bin/env python3
"""Synthetic-only native profiles. No remote deployment, OAuth or tunnel actions."""
import argparse,io,tarfile,contextlib,fcntl,stat,datetime,hashlib,json,os,re,secrets,shutil,subprocess,sys,tomllib
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent
REPO=BASE.parents[1]
PROFILES={'test':(55321,55322,55173,55323,8183),'staging':(56321,56322,56173,56323,8283)}

def private_write(p,data):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
 with os.fdopen(fd,'w')as f:
  st=os.fstat(f.fileno())
  if not stat.S_ISREG(st.st_mode)or st.st_uid!=os.getuid()or st.st_nlink!=1:raise RuntimeError('PRIVATE_WRITE_GUARD')
  os.fchmod(f.fileno(),0o600);os.ftruncate(f.fileno(),0);f.write(data);f.flush();os.fsync(f.fileno())

def private_json(p):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd)as f:
  st=os.fstat(f.fileno())
  if not stat.S_ISREG(st.st_mode)or st.st_uid!=os.getuid()or st.st_mode&0o077 or st.st_nlink!=1:raise RuntimeError('PRIVATE_FILE_GUARD')
  return json.load(f)

def safe_ancestors(p):
 for part in [p,*p.parents]:
  if part.is_symlink():raise RuntimeError('SYMLINK_ROOT_REJECTED')
  if part.exists() and not part.is_dir():raise RuntimeError('ROOT_NOT_DIRECTORY')
def base_root():
 base=Path('/workspace/barber-cloud-candidate-state')
 if os.environ.get('BARBER_CLOUD_PROFILE_ROOT',str(base))!=str(base):raise RuntimeError('EXACT_OWNED_ROOT_REQUIRED')
 safe_ancestors(base)
 if base.stat().st_uid!=os.getuid()or base.stat().st_mode&0o077:raise RuntimeError('ROOT_OWNER_MODE')
 marker=base/'.barber-cloud-owner.json'
 if not marker.is_file() or marker.is_symlink():raise RuntimeError('ROOT_OWNERSHIP_MARKER_REQUIRED')
 st=marker.stat()
 if st.st_uid!=os.getuid() or st.st_mode&0o077:raise RuntimeError('ROOT_OWNER_MODE')
 d=private_json(marker)
 if d!={'schema':1,'application':'barber-cloud-candidate','source_sha':source_sha()}:raise RuntimeError('UNKNOWN_ROOT_MARKER')
 return base

def checked_root(profile):
 if profile not in PROFILES:raise RuntimeError('PROFILE_ALLOWLIST')
 r=base_root()/profile;safe_ancestors(r)
 return r

@contextlib.contextmanager
def operation_lock(profile):
 p=base_root()/('.'+profile+'.operation.lock')
 fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  st=os.fstat(fd)
  if st.st_uid!=os.getuid()or st.st_mode&0o077 or st.st_nlink!=1:raise RuntimeError('LOCK_OWNER_MODE')
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
 finally:os.close(fd)

def source_commit(require_clean=False):
 p=subprocess.run(['git','rev-parse','HEAD'],cwd=REPO,capture_output=True,text=True)
 if p.returncode:raise RuntimeError('CANDIDATE_COMMIT_REQUIRED')
 if require_clean:
  d=subprocess.run(['git','status','--porcelain'],cwd=REPO,capture_output=True,text=True,check=True)
  if d.stdout.strip():raise RuntimeError('DIRTY_STAGING_SOURCE')
 return p.stdout.strip()

def validate_owner_identity(record,observed,r,expected):
 if observed['uid']!=os.getuid():raise RuntimeError('PROCESS_OWNER_MISMATCH')
 if str(r).encode()not in observed['command']:raise RuntimeError('OWNER_COMMAND_MISMATCH')
 if Path(observed['exe']).resolve()!=expected.resolve():raise RuntimeError('OWNER_EXECUTABLE_MISMATCH')
 recorded=datetime.datetime.fromisoformat(record['startedAt'].replace('Z','+00:00')).timestamp()
 if abs(observed['created']-recorded)>10:raise RuntimeError('OWNER_START_IDENTITY_MISMATCH')

def verify_process_identity(profile,r):
 for directory in [r/'native-home',r/'native-home/stacks',r/'native-stack',r/'native-stack/supabase']:
  safe_ancestors(directory)
 stacks=r/'native-home/stacks'
 for p in stacks.glob('*/state.json'):
  if p.is_symlink():raise RuntimeError('STATE_SYMLINK')
  d=private_json(p);identity=d.get('identity',{})
  if d.get('id')!=p.parent.name:raise RuntimeError('STACK_ID_MISMATCH')
  if identity.get('projectRoot')!=str(r/'native-stack') or identity.get('stackName')!='barber-cloud-'+profile or d.get('runtime')!='native':raise RuntimeError('PROCESS_IDENTITY_MISMATCH')
  owner=p.with_name('owner.json')
  if owner.exists():
   record=private_json(owner);pid=record.get('pid')
   if not isinstance(pid,int)or pid<=1:raise RuntimeError('INVALID_OWNER_PID')
   proc=Path('/proc')/str(pid)
   if not proc.exists():raise RuntimeError('OWNER_STALE_PID')
   cli=Path(os.environ.get('BARBER_NATIVE_CLI',str(BASE/'tooling/native/node_modules/.bin/supabase'))).resolve()
   expected=cli.parents[2]/'@supabase/cli-linux-x64/bin/supabase'
   ticks=int((proc/'stat').read_text().rsplit(')',1)[1].split()[19]);boot=int(next(l.split()[1]for l in Path('/proc/stat').read_text().splitlines()if l.startswith('btime ')))
   validate_owner_identity(record,{'uid':proc.stat().st_uid,'command':(proc/'cmdline').read_bytes(),'exe':os.readlink(proc/'exe'),'created':boot+ticks/os.sysconf('SC_CLK_TCK')},r,expected)

def snapshot_source(destination,commit):
 raw=subprocess.run(['git','archive',commit],cwd=REPO,capture_output=True,check=True).stdout
 destination.mkdir(mode=0o700)
 with tarfile.open(fileobj=io.BytesIO(raw))as archive:
  for member in archive.getmembers():
   q=Path(member.name)
   if q.is_absolute()or '..'in q.parts or member.issym()or member.islnk():raise RuntimeError('SOURCE_ARCHIVE_GUARD')
  archive.extractall(destination,filter='data')
 hashes={str(p.relative_to(destination)):hashlib.sha256(p.read_bytes()).hexdigest()for p in destination.rglob('*')if p.is_file()}
 private_write(destination.parent/'source-receipt.json',json.dumps({'commit':commit,'files':hashes},sort_keys=True))

def source_repo(name):
 r=checked_root(name)
 if name!='staging':return REPO
 d=private_json(r/'source-receipt.json');m=private_json(r/'profile.json')
 if d['commit']!=m['candidate_commit']:raise RuntimeError('STAGING_COMMIT_MISMATCH')
 expected=d['files'];actual={str(p.relative_to(r/'source'))for p in(r/'source').rglob('*')if p.is_file()and 'node_modules'not in p.relative_to(r/'source').parts}
 if actual!=set(expected):raise RuntimeError('DIRTY_STAGING_SOURCE')
 for rel,digest in expected.items():
  p=r/'source'/rel
  if p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise RuntimeError('DIRTY_STAGING_SOURCE')
 return r/'source'

def init(profile):
 r=checked_root(profile)
 if r.exists():raise RuntimeError('PROFILE_ALREADY_EXISTS')
 commit=source_commit(profile=='staging') # Reject dirty Staging before creating any resource.
 r.mkdir(parents=True,mode=0o700)
 (r/'results').mkdir(mode=0o700);(r/'native-stack/supabase').mkdir(parents=True)
 api,db,web,mail,inspector=PROFILES[profile]
 if profile=='staging':snapshot_source(r/'source',commit)
 source=(r/'source'if profile=='staging'else REPO)/'supabase';target=r/'native-stack/supabase'
 for n in ['migrations','functions','tests']:shutil.copytree(source/n,target/n)
 for n in ['seed.sql','schema.expected.sql','.baseline-ready']:shutil.copy2(source/n,target/n)
 shutil.copy2(HERE/'native-services.lock.json',target/'supabase.lock')
 s=(HERE/'config.template.toml').read_text().replace('project_id = "barber-cloud-compatibility"',f'project_id = "barber-cloud-{profile}"')
 for old,new in [(54321,api),(54322,db),(54320,db-2),(54323,api+2),(54324,api+3),(54325,api+4),(54326,api+5),(54327,api+6),(54329,api+8),(5173,web),(8083,inspector)]:s=re.sub(r'(?<!\d)'+str(old)+r'(?!\d)',str(new),s)
 # Mail port is a native service allocation; leave native resolver its own process ports.
 s=s.replace('[auth]', '[auth]\njwt_secret = "env(SUPABASE_AUTH_JWT_SECRET)"',1)
 s=s.replace('[auth]', '[auth]\nsigning_keys_path = '+json.dumps(str(target/'keys.json'))+'\npublishable_key = "env(CLOUD_PUBLISHABLE_KEY)"\nsecret_key = "env(CLOUD_SECRET_KEY)"',1)
 private_write(target/'config.toml',s)
 node=os.environ.get('BARBER_NODE',str(BASE/'tooling/node/node_modules/.bin/node'))
 if hashlib.sha256(Path(node).read_bytes()).hexdigest()!=json.loads((BASE/'tool-versions.json').read_text())['installed_binary_sha256']['node']:raise RuntimeError('PINNED_NODE_HASH_FAILED')
 jwk_script="const c=require('node:crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});Object.assign(k,{kid:c.randomUUID(),alg:'ES256',use:'sig',key_ops:['sign','verify']});process.stdout.write(JSON.stringify([k]));"
 jwks=subprocess.run([node,'-e',jwk_script],capture_output=True,text=True,check=True).stdout
 private_write(target/'keys.json',jwks)

 values={
  'SUPABASE_AUTH_JWT_SECRET':secrets.token_urlsafe(48),
  'CLOUD_PUBLISHABLE_KEY':'sb_publishable_'+secrets.token_urlsafe(32),
  'CLOUD_SECRET_KEY':'sb_secret_'+secrets.token_urlsafe(32),
  'CLOUD_CRON_SHARED_SECRET':secrets.token_urlsafe(32),
  'CLOUD_WHATSAPP_APP_SECRET':secrets.token_urlsafe(32),
  'CLOUD_WHATSAPP_VERIFY_TOKEN':secrets.token_urlsafe(32),
 }
 key=subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048'],capture_output=True,check=True).stdout
 pub=subprocess.run(['openssl','pkey','-pubout'],input=key,capture_output=True,check=True).stdout
 values.update(CLOUD_WHATSAPP_FLOW_PRIVATE_KEY=key.decode(),CLOUD_WHATSAPP_FLOW_PUBLIC_KEY=pub.decode())
 private_write(r/'synthetic-secrets.json',json.dumps(values));del key,values
 # Sharing only the pinned extracted binary cache is supported for local proof;
 # data, config, stack process metadata, JWT/Auth/Storage remain per profile.
 (r/'native-home').mkdir();cache=os.environ.get('BARBER_SHARED_NATIVE_CACHE')
 if cache:
  cache=Path(cache).resolve()
  if not cache.is_dir():raise RuntimeError('PINNED_CACHE_MISSING')
  subprocess.run(['cp','-a','--reflink=auto',str(cache),str(r/'native-home/cache')],check=True) # private copy; never share writable cache
 private_write(r/'profile.json',json.dumps({'schema':1,'profile':profile,'source_sha':source_sha(),'ports':PROFILES[profile],'created':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic_only':True,'candidate_commit':commit,'nonce':secrets.token_hex(32)}))
 print('PROFILE_INITIALIZED '+profile)

def source_sha():
 # No git checkout or commit required in a source-transfer candidate.
 return json.loads((BASE/'candidate.json').read_text())['source_sha']
def context(profile):
 r=checked_root(profile)
 for f in ['profile.json','synthetic-secrets.json','native-stack/supabase/config.toml','native-stack/supabase/keys.json']:
  p=r/f
  if p.is_symlink()or p.stat().st_uid!=os.getuid()or p.stat().st_mode&0o077:raise RuntimeError('PRIVATE_FILE_GUARD')
 m=private_json(r/'profile.json')
 if m['profile']!=profile or m['synthetic_only']is not True or m['source_sha']!=source_sha() or m['ports']!=list(PROFILES[profile]) or not re.fullmatch('[0-9a-f]{64}',m.get('nonce','')):raise RuntimeError('PROFILE_GUARD')
 if profile=='staging':source_repo(profile)
 verify_process_identity(profile,r)
 env=os.environ.copy();env.update(private_json(r/'synthetic-secrets.json'));env.update(SUPABASE_HOME=str(r/'native-home'),DO_NOT_TRACK='1',SUPABASE_TELEMETRY_DISABLED='1',SUPABASE_EXPERIMENTAL_STACK='true')
 env['SUPABASE_INTERNAL_SLIM_RELEASES_URL']='http://127.0.0.1:58081'
 cli=Path(os.environ.get('BARBER_NATIVE_CLI',str(BASE/'tooling/native/node_modules/.bin/supabase')))
 if not cli.exists():raise RuntimeError('INSTALL_LOCKED_NATIVE_CLI')
 return r,env,cli

def native(profile,*args):
 r,env,cli=context(profile)
 if args[0]=='stop' and not any((r/'native-home/stacks').glob('*/owner.json')):return 'ALREADY_STOPPED'
 if hashlib.sha256(cli.read_bytes()).hexdigest()!=json.loads((BASE/'tool-versions.json').read_text())['installed_binary_sha256']['native_cli']:raise RuntimeError('PINNED_CLI_HASH_FAILED')
 p=subprocess.run([str(cli),'stack',*args,'--workdir',str(r/'native-stack'),'--stack','barber-cloud-'+profile],env=env,capture_output=True,text=True,timeout=180)
 private_write(r/'results/native-last.log',p.stdout+'\n'+p.stderr)
 if p.returncode:raise RuntimeError('NATIVE_'+args[0].upper()+'_FAILED')
 if args[0] in ['start','status']:
  rows=[]
  for l in p.stdout.splitlines():
   try:
    d=json.loads(l)
    if 'env'in d:rows.append(d)
    elif isinstance(d.get('result'),dict) and 'env'in d['result']:rows.append(d['result'])
   except (ValueError,AttributeError):pass
  if rows:private_write(r/'status-private.json',json.dumps(rows[-1]))
 return p.stdout

def db(profile,sql=None,file=None,admin=False,transaction=False):
 r,env,_=context(profile);v=json.loads((r/'status-private.json').read_text())['env']
 from urllib.parse import urlparse,unquote
 u=urlparse(v['DB_URL'])
 if u.hostname not in ['127.0.0.1','localhost'] or u.port!=PROFILES[profile][1]:raise RuntimeError('LOCAL_DATABASE_GUARD')
 psql=next((r/'native-home/cache').rglob('bin/psql'));env['PGPASSWORD']=unquote(u.password or '')
 user='supabase_admin'if admin else u.username
 a=[str(psql),'-X','-v','ON_ERROR_STOP=1','-h',u.hostname,'-p',str(u.port),'-U',user,'-d',u.path.lstrip('/'),'-At']
 p=subprocess.run(a+(['--single-transaction']if transaction else[])+(['-f',str(file)]if file else['-c',sql]),env=env,capture_output=True,text=True,timeout=90)
 if p.returncode:
  private_write(r/'results'/('db-error-'+datetime.datetime.now().strftime('%H%M%S%f')+'.log'),p.stderr);raise RuntimeError('DATABASE_SQL_FAILED')
 return p.stdout

def start(profile,db_only=False):
 exclude='studio,analytics,pooler'
 if db_only:exclude+=',auth,rest,realtime,storage,functions,mail'
 native(profile,'start','--runtime','native','--exclude',exclude,'--eager','--frozen')
 print('NATIVE_READY '+profile)

def replay(profile):
 r,env,_=context(profile);s=r/'native-stack/supabase'
 if db(profile,"SHOW cron.launch_active_jobs").strip()!='off':raise RuntimeError('CRON_MUST_BE_OFF_BEFORE_REPLAY')
 # Fresh platform bootstrap supplies Auth helpers/extensions. No retained proof reset.
 db(profile,"ALTER SCHEMA public OWNER TO pg_database_owner; COMMENT ON SCHEMA public IS 'standard public schema'; GRANT USAGE ON SCHEMA public TO postgres,anon,authenticated,service_role;")
 for f in sorted((s/'migrations').glob('*.sql')):db(profile,file=f,transaction=True)
 # Direct administrative seed INSERT (not trigger) requires trusted installer
 # postgres BYPASSRLS in this native bootstrap. Never change private writer RLS.
 role=db(profile,"SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='postgres'").strip()
 if role!='t':db(profile,'ALTER ROLE postgres BYPASSRLS',admin=True)
 db(profile,file=s/'seed.sql')
 print('CLEAN_REPLAY_SEED_PASS '+profile)

def baseline(profile):
 return json.loads(db(profile,"SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'bookings',(SELECT count(*) FROM public.bookings),'cron',current_setting('cron.launch_active_jobs'))"))
def main():
 os.umask(0o077);a=argparse.ArgumentParser();a.add_argument('command',choices=['init','start','stop','reset','replay','baseline','pgtap','disable-cron']);a.add_argument('profile',choices=PROFILES);a.add_argument('--db-only',action='store_true');x=a.parse_args()
 with operation_lock(x.profile):dispatch(x)
def dispatch(x):
 if x.command=='init':init(x.profile)
 elif x.command=='reset':
  r,_,_=context(x.profile)
  if (r/'frontend-process.json').exists():
   import frontend;frontend.stop(x.profile,r)
  native(x.profile,'stop')
  archive=r.with_name(x.profile+'-previous-'+datetime.datetime.now().strftime('%Y%m%dT%H%M%S%f'));r.rename(archive);init(x.profile);print('OWNED_PROFILE_RESET_ARCHIVED')
 elif x.command=='start':start(x.profile,x.db_only)
 elif x.command=='stop':native(x.profile,'stop');print('STOPPED '+x.profile)
 elif x.command=='disable-cron':
  db(x.profile,"ALTER SYSTEM SET cron.launch_active_jobs='off'",admin=True);native(x.profile,'stop');start(x.profile,True)
  if db(x.profile,'SHOW cron.launch_active_jobs').strip()!='off':raise RuntimeError('CRON_NOT_DISABLED')
  print('CRON_OFF '+x.profile)
 elif x.command=='replay':replay(x.profile)
 elif x.command=='baseline':print(json.dumps(baseline(x.profile)))
 elif x.command=='pgtap':
  r,_,_=context(x.profile)
  for f in sorted((r/'native-stack/supabase/tests').glob('*.sql')):
   out=db(x.profile,file=f);private_write(r/'results'/f'{f.name}.tap',out)
   if re.search(r'^not ok\b',out,re.M)or not re.search(r'^1\.\.\d+',out,re.M):raise RuntimeError('PGTAP_FAILED')
  print('PGTAP_PASS '+x.profile)
if __name__=='__main__':
 try:main()
 except Exception as e:print('PROFILE_FAILED '+str(e)if re.fullmatch('[A-Z_ ]+',str(e))else'PROFILE_FAILED SAFE_CATEGORY_LOCAL_ERROR',file=sys.stderr);sys.exit(1)
