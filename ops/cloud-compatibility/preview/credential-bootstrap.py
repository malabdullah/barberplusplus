import os
"""Default plan-only. No real login is run by tests or imports."""
import argparse,hashlib,json,os,re,resource,secrets,selectors,shutil,signal,stat,subprocess,sys,tempfile,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
CLI_SHA='723d6aebdc226064aef321258fb17c8a2770c9cc2bd05004c0fb83e72b302c3f'
ATTRS=['application','barber-private-owner-review','purpose','creator-github']
PLAN={'mode':'PLAN ONLY','login':['user','login','-g','-d'],'scopes':['read:user','read:org'],'cacheExceptionRequired':True,'region':'use','port':5180,'maxHostSeconds':3600,'noExistingCredentials':True}
PHASE='INIT';LIVE=False
CATEGORIES={'GUARD_REJECTED','CACHE_SCHEMA','CACHE_TOKEN_FORMAT','CACHE_EXPIRY','CACHE_SCOPES','CACHE_IDENTITY','CACHE_UNAVAILABLE','CACHE_API_FAILURE','CACHE_SECURE_UNCONFIGURED','CACHE_ERASE_FAILED','SECRET_STORE','SECRET_VERIFY','KEYRING_VERIFY','CLI_TLS','CLI_AUTH','CLI_EXIT','CLI_TIMEOUT','DEVICE_DISPLAY','HOST_EXIT','LOCAL_EXCEPTION'}
PHASES={'INIT','PRIVATE_PROFILE_READY','CLI_LOGIN_STARTED','DEVICE_CHALLENGE_SHOWN','CLI_LOGIN_EXIT_OK','CACHE_READ','CACHE_VALIDATED','ENCRYPTED_IMPORT_VERIFIED','CLI_RAM_ERASED','SDK_HOST_STARTED','RAM_PROFILE_REMOVED'}
def mark(phase):
 global PHASE
 if phase not in PHASES:raise ValueError('Invalid fixed phase')
 PHASE=phase
 if LIVE:
  target=Path(os.environ['BARBER_CLOUD_STATE'])/'results/preview-live-events.jsonl'
  with target.open('a',encoding='utf8')as f:f.write(json.dumps({'time':time.time(),'phase':phase})+'\n')
class StageFailure(RuntimeError):
 def __init__(self,category):
  if category not in CATEGORIES:category='LOCAL_EXCEPTION'
  self.category=category;self.phase=PHASE;super().__init__('BOOTSTRAP_FAILED')
def fail(category='GUARD_REJECTED'):raise StageFailure(category)
def unique_pairs(pairs):
 d={}
 for k,v in pairs:
  if k in d:fail()
  d[k]=v
 return d
def parse_cache(raw,now=None):
 try:
  if len(raw)>65536:fail()
  rows=json.loads(raw,object_pairs_hook=unique_pairs);now=time.time() if now is None else now
  if not isinstance(rows,list) or len(rows)!=1:fail()
  r=rows[0]
  if not isinstance(r,dict) or set(r)-{'accessToken','expiration','refreshToken','refreshExpiration','scopes','userId','login'}:fail()
  token=r.get('accessToken');expiry=r.get('expiration');uid=r.get('userId');login=r.get('login')
  if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9_\-.]{20,4096}',token):fail('CACHE_TOKEN_FORMAT')
  if type(expiry)is not int or expiry>2650467743999999999 or (expiry/10000000-11644473600)<now+3700:fail('CACHE_EXPIRY')
  if type(r.get('scopes'))is not list or any(type(v)is not str for v in r['scopes'])or sorted(r['scopes'])!=['read:org','read:user']:fail('CACHE_SCOPES')
  if not isinstance(uid,int) or isinstance(uid,bool) or uid<=0 or uid>18446744073709551615 or not isinstance(login,str) or not re.fullmatch('[A-Za-z0-9-]{1,39}',login):fail()
  if login.casefold()!='malabdullah':fail('CACHE_IDENTITY')
  return token.encode() # Refresh token and identity are deliberately not imported.
 except StageFailure:raise
 except Exception:fail('CACHE_SCHEMA')
def erase_state(state):
 # Only a freshly created, owned direct child. No following symlinks.
 for p in state.iterdir():
  if p.is_symlink() or not p.is_file():fail()
  p.unlink()
 if any(state.iterdir()):fail()
class Profile:
 def __init__(self,cfg):self.cfg=cfg;self.root=None;self.daemon=None;self.children=[]
 def command(self,args,data=None,timeout=8):return subprocess.run(args,input=data,env=self.env,capture_output=True,timeout=timeout)
 def __enter__(self):
  try:
   self.root=Path(tempfile.mkdtemp(prefix='barber-owner-',dir='/dev/shm'));self.root.chmod(0o700)
   m=json.loads(subprocess.check_output(['findmnt','-J','-T',str(self.root)],text=True))['filesystems'][0]
   if m['fstype']!='tmpfs':fail()
   self.env=os.environ.copy();self.home=self.env.get('HOME')
   for k in list(self.env):
    if k.startswith(('DEVTUNNELS_','BASIS_')):self.env.pop(k)
   for name in ['data','config','cache','runtime','control','state']:(self.root/name).mkdir(mode=0o700)
   for k,v in [('XDG_DATA_HOME','data'),('XDG_CONFIG_HOME','config'),('XDG_CACHE_HOME','cache'),('XDG_RUNTIME_DIR','runtime'),('GNOME_KEYRING_CONTROL','control'),('DEVTUNNELS_USER_STATE_DIR','state')]:self.env[k]=str(self.root/v)
   if not self.env.get('DBUS_SESSION_BUS_ADDRESS'):fail()
   self.env['LD_LIBRARY_PATH']=self.cfg['libraryDir'];self.env['DOTNET_BUNDLE_EXTRACT_BASE_DIR']=self.cfg['bundleCache']
   self.env['SSL_CERT_FILE']=self.cfg['caBundle']
   # Inherited proxy and CA remain mandatory. Never HOME override or TLS relaxation.
   if not self.env.get('HTTPS_PROXY'):fail()
   unlock=secrets.token_bytes(32).hex().encode()
   self.daemon=subprocess.Popen([self.cfg['keyringDaemon'],'--foreground','--unlock','--components=secrets','--control-directory',str(self.root/'control')],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=self.env)
   self.daemon.stdin.write(unlock);self.daemon.stdin.close();del unlock
   until=time.monotonic()+5
   while time.monotonic()<until:
    p=self.command(['gdbus','call','--session','--dest','org.freedesktop.secrets','--object-path','/org/freedesktop/secrets/collection/login','--method','org.freedesktop.DBus.Properties.Get','org.freedesktop.Secret.Collection','Locked'])
    if p.returncode==0 and b'false'in p.stdout:break
    time.sleep(.1)
   else:fail()
   if any((self.root/'state').iterdir()):fail()
   mark('PRIVATE_PROFILE_READY');return self
  except BaseException:self.__exit__(None,None,None);raise
 def __exit__(self,*unused):
  for p in self.children+([self.daemon]if self.daemon else[]):
   if p.poll()is None:
    p.terminate()
    try:p.wait(timeout=3 if p is self.daemon else 12)
    except subprocess.TimeoutExpired:p.kill();p.wait()
  if self.root:shutil.rmtree(self.root);mark('RAM_PROFILE_REMOVED')
 def import_new_cache(self):
  state=self.root/'state';p=state/'devtunnels-tokens-github';mode=None
  api_root=HERE.parent/'tooling/msal-official-api'
  api=[str(api_root/'dotnet/dotnet'),str(api_root/'probe/bin/Debug/net10.0/Probe.dll')]
  try:
   mark('CACHE_READ')
   if p.is_symlink():fail('CACHE_UNAVAILABLE')
   if p.exists():
    st=p.stat()
    if not stat.S_ISREG(st.st_mode)or st.st_uid!=os.getuid()or st.st_nlink!=1 or st.st_mode&0o077:fail('CACHE_UNAVAILABLE')
   # File absence or a zero-byte notification marker is not proof of plaintext.
   mode='ram'if p.exists()and p.stat().st_size>0 else'secure'
   result=self.command([*api,mode+'-read',str(self.root)],timeout=10)
   if result.returncode:fail('CACHE_SECURE_UNCONFIGURED'if b'MSAL_PROPERTIES_UNCONFIGURED'in result.stderr else'CACHE_API_FAILURE')
   raw=result.stdout
   token=parse_cache(raw);del raw;mark('CACHE_VALIDATED')
   result=self.command([self.cfg['secretTool'],'store','--label=Barber temporary owner credential',*ATTRS],token)
   if result.returncode:fail('SECRET_STORE')
   check=self.command([self.cfg['secretTool'],'lookup',*ATTRS])
   if check.returncode or not secrets.compare_digest(check.stdout,token):fail('SECRET_VERIFY')
   files=list((self.root/'data/keyrings').glob('*.keyring'))
   if not files or any(not f.read_bytes().startswith(b'GnomeKeyring\n\r')or token in f.read_bytes()for f in files):fail('KEYRING_VERIFY')
   del token,check;mark('ENCRYPTED_IMPORT_VERIFIED')
  finally:
   try:
    if mode and (mode!='ram'or p.exists()):
     cleared=self.command([*api,mode+'-clear',str(self.root)],timeout=10)
     if cleared.returncode and mode=='ram':fail('CACHE_ERASE_FAILED')
   finally:erase_state(state);mark('CLI_RAM_ERASED') # No residual plaintext file, on every path.
 def login(self):
  binary=Path(self.cfg['cli'])
  if hashlib.sha256(binary.read_bytes()).hexdigest()!=CLI_SHA:fail()
  if any((self.root/'state').iterdir()):fail()
  # Only official CLI OAuth client; no client override, connector, token or existing state.
  mark('CLI_LOGIN_STARTED')
  p=subprocess.Popen([str(binary),'user','login','-g','-d'],env=self.env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  self.children.append(p);sel=selectors.DefaultSelector();buffer=b'';shown=False;until=time.monotonic()+600
  for f in [p.stdout,p.stderr]:os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ)
  try:
   while sel.get_map():
    if time.monotonic()>until:fail('CLI_TIMEOUT')
    for key,_ in sel.select(.2):
     chunk=os.read(key.fileobj.fileno(),4096)
     if not chunk:sel.unregister(key.fileobj);continue
     buffer=(buffer+chunk)[-16384:]
     # Only emit documented verification URL + code directly to controlling terminal.
     # Never relay raw CLI messages, errors, account data or token-shaped strings.
     match=re.search(rb'https://github\.com/login/device[^\r\n]{0,120}?enter the code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})',buffer)
     if match and not shown:
      if not os.isatty(1):fail()
      os.write(1,b'Official GitHub device approval: https://github.com/login/device code '+match.group(1)+b'\n')
      shown=True;mark('DEVICE_CHALLENGE_SHOWN')
   if p.wait(timeout=3)!=0:
    lowered=buffer.lower()
    fail('CLI_TLS'if b'certificate'in lowered or b'ssl connection'in lowered else 'CLI_AUTH'if b'authorization'in lowered or b'authentication'in lowered else 'CLI_EXIT')
   if not shown:fail('DEVICE_DISPLAY')
   mark('CLI_LOGIN_EXIT_OK')
   self.import_new_cache()
  finally:
   sel.close();buffer=b''
   try:
    if p.poll()is None:
     p.terminate()
     try:p.wait(timeout=3)
     except subprocess.TimeoutExpired:p.kill();p.wait()
   finally:erase_state(self.root/'state');mark('CLI_RAM_ERASED')
def restore_profile_routing(profile):
 # The runner may exit at its hard deadline before its own finally executes.
 # Use the current durable-recovery reference, not the retired RAM config file.
 if (profile.root/'routing-recovery-reference.json').exists():
  r=profile.command([sys.executable,str(HERE/'auth-origin.py'),'restore','--owner-approved','--receipt-dir',str(profile.root)],timeout=380)
  if r.returncode:fail()

def main():
 global LIVE
 signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
 os.umask(0o077);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 a=argparse.ArgumentParser();a.add_argument('--tty-preflight',action='store_true');a.add_argument('--live',action='store_true');a.add_argument('--owner-approved',action='store_true');a.add_argument('--owner-reviewed-ram-cache-exception',action='store_true');a.add_argument('--config');a.add_argument('--private-bus-worker',action='store_true');args=a.parse_args()
 if args.tty_preflight:
  if not os.isatty(1):fail()
  os.write(1,b'SYNTHETIC TTY PREFLIGHT PASS; no login/device initiation\n');return
 if not args.live:print(json.dumps(PLAN,indent=2));return
 if not args.owner_approved or not args.owner_reviewed_ram_cache_exception or not args.config or not os.isatty(1):fail()
 if not args.private_bus_worker:
  # Always new bus. Do not choose an existing user's service or credential store.
  e=os.environ.copy();e['BARBER_PRIVATE_BUS_LAUNCH']='new-task-owned-session'
  result=subprocess.run(['dbus-run-session','--',sys.executable,str(HERE/'credential-bootstrap.py'),*sys.argv[1:],'--private-bus-worker'],env=e);raise SystemExit(result.returncode)
 if os.environ.get('BARBER_PRIVATE_BUS_LAUNCH')!='new-task-owned-session':fail()
 LIVE=True
 sys.path.insert(0,str(HERE.parent/'runtime'));import profile
 selected=os.environ.get('BARBER_CLOUD_PROFILE')
 if selected not in profile.PROFILES or str(profile.checked_root(selected))!=os.environ.get('BARBER_CLOUD_STATE'):fail()
 profile.context(selected) # Fail closed before any OAuth or fresh profile creation.
 cfg=json.loads(Path(args.config).read_text())
 with Profile(cfg)as profile:
  profile.env['BARBER_SECRET_TOOL']=cfg['secretTool'];profile.env['BARBER_CA_BUNDLE']=cfg['caBundle']
  profile.env['BARBER_LIVE_APPROVED']='1'
  profile.login() # NOT executed during preparation/tests.
  mark('SDK_HOST_STARTED')
  p=subprocess.Popen([cfg['node'],str(HERE/'run-host.mjs'),'--owner-approved',str(profile.root),cfg['publishableConfig']],env=profile.env,stdin=subprocess.DEVNULL,stdout=None,stderr=subprocess.DEVNULL)
  profile.children.append(p)
  try:
   if p.wait(timeout=3610)!=0:fail('HOST_EXIT')
  except subprocess.TimeoutExpired:fail()
  finally:
   if p.poll() is None:
    p.terminate()
    try:p.wait(timeout=12)
    except subprocess.TimeoutExpired:p.kill();p.wait()
   restore_profile_routing(profile)
if __name__=='__main__':
 try:main()
 except BaseException as e:
  if isinstance(e,SystemExit):raise
  phase=e.phase if isinstance(e,StageFailure)else PHASE
  category=e.category if isinstance(e,StageFailure)else 'LOCAL_EXCEPTION'
  print('BOOTSTRAP_FAILED stage='+phase+' category='+category,file=sys.stderr);raise SystemExit(1)
