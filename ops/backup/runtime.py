"""Reviewed backup operations. No activation, SQL migration or restore operation.
Configuration stays disabled until export/backup activation is approved.
"""
import argparse,base64,datetime,fcntl,hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time
CONFIG=pathlib.Path('/etc/barber-backup/config.json')
STATE=pathlib.Path('/var/lib/barber-backup')
TOOLS=pathlib.Path('/var/lib/barber-release-backend/tools')
BUCKET='barber-production-recovery-malabdullah-20261012'
ENDPOINT='https://s3.us-east-005.backblazeb2.com'
PG_IMAGE='sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
HBA=b'# BEGIN Barber backup local-only authentication\nlocal replication barber_backup scram-sha-256\nlocal postgres barber_backup scram-sha-256\n# END Barber backup local-only authentication\n'
FIXED_FILES=['/root/supabase/docker/.env','/root/supabase/docker/volumes/storage','/root/supabase/docker/volumes/functions','/var/lib/docker/volumes/supabase_db-config/_data','/etc/barber-release','/etc/barber-backup']

def private(path):
 p=pathlib.Path(path)
 if p.is_symlink() or not p.is_file() or p.stat().st_uid!=0 or p.stat().st_mode&0o077:raise ValueError('Expected a private root-owned file')
 return p.read_text().strip()

def validate(c):
 if c.get('enabled') is not True:raise ValueError('Production backup activation is disabled')
 if c.get('host')!='srv1073968' or c.get('bucket')!=BUCKET or c.get('endpoint')!=ENDPOINT or c.get('prefix')!='production/v1/' or c.get('role')!='barber_backup' or c.get('slot')!='barber_production_recovery':raise ValueError('Backup destination or identity differs from review')
 if not re.fullmatch(r'[0-9]{10,20}',c.get('systemId','')):raise ValueError('Reviewed PostgreSQL system identity required')
 if not re.fullmatch(r'[a-f0-9]{64}',c.get('originalHbaSha256','')):raise ValueError('Original authentication fingerprint required')
 if not c.get('composeFiles') or any(not re.fullmatch(r'/root/supabase/docker/[a-zA-Z0-9_.-]+\.ya?ml',x) for x in c['composeFiles']):raise ValueError('Unexpected Compose backup path')
 if c.get('walgSha256')!='8015836f246a978f27b31a2462eac7765312558ae5b11ac033322b555abf9e22' or c.get('resticSha256')!='20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639':raise ValueError('Unreviewed backup executable')

def atomic(name,value):
 fd,path=tempfile.mkstemp(prefix='.pending-',dir=STATE)
 try:
  with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
  os.replace(path,STATE/name)
 finally:
  if os.path.exists(path):os.unlink(path)

def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def command(args,env=None,timeout=120):
 p=subprocess.run([str(a) for a in args],input=None,env=env,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Backup command failed with exit '+str(p.returncode))
 return p.stdout

def sql(query):return command(['docker','exec','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-c',query])

def runtime(c):
 validate(c)
 state=json.loads(command(['docker','inspect','supabase-db']))[0]
 if not state['State']['Running'] or state['Image']!=PG_IMAGE:raise ValueError('Reviewed production PostgreSQL image must be running')
 meta=json.loads(sql("BEGIN READ ONLY; SELECT json_build_object('systemId',(SELECT system_identifier::text FROM pg_control_system()),'socket',current_setting('unix_socket_directories'),'hba',current_setting('hba_file'),'role',(SELECT json_build_object('replication',rolreplication,'super',rolsuper,'bypass',rolbypassrls,'createRole',rolcreaterole,'createDb',rolcreatedb) FROM pg_roles WHERE rolname='barber_backup')); COMMIT;"))
 if meta['systemId']!=c['systemId'] or meta['socket']!='/var/run/postgresql' or meta['hba']!='/etc/postgresql/pg_hba.conf':raise ValueError('Database identity/configuration changed')
 if meta['role']!={'replication':True,'super':False,'bypass':False,'createRole':False,'createDb':False}:raise ValueError('Unexpected backup role permissions')
 root=pathlib.Path('/proc')/str(state['State']['Pid'])/'root'
 hba=(root/'etc/postgresql/pg_hba.conf').read_bytes()
 if not hba.startswith(HBA) or hashlib.sha256(hba[len(HBA):]).hexdigest()!=c['originalHbaSha256']:raise ValueError('Backup authentication or original rules changed; operator reconciliation required')
 b2=json.loads(private('/etc/barber-backup/b2.json'))
 if b2.get('endpoint')!=ENDPOINT or b2.get('bucket_name')!=BUCKET or b2.get('name_prefix')!='production/v1/':raise ValueError('B2 credential scope configuration changed')
 password=private('/etc/barber-backup/postgres.password')
 if not re.fullmatch('[a-f0-9]{64}',password):raise ValueError('Invalid private backup password')
 sodium=private('/etc/barber-backup/walg.key')
 if len(base64.b64decode(sodium,validate=True))!=32:raise ValueError('Invalid private backup encryption key')
 env={'PATH':'/usr/bin:/bin','HOME':'/root','AWS_ACCESS_KEY_ID':b2['key_id'].strip(),'AWS_SECRET_ACCESS_KEY':b2['application_key'].strip(),'AWS_ENDPOINT':ENDPOINT,'AWS_REGION':'us-east-005','AWS_S3_FORCE_PATH_STYLE':'true','AWS_EC2_METADATA_DISABLED':'true','WALG_S3_PREFIX':'s3://'+BUCKET+'/production/v1/pg17-'+c['systemId'],'WALG_COMPRESSION_METHOD':'zstd','WALG_LIBSODIUM_KEY_PATH':'/etc/barber-backup/walg.key','WALG_LIBSODIUM_KEY_TRANSFORM':'base64','WALG_DELTA_MAX_STEPS':'0','WALG_PREVENT_WAL_OVERWRITE':'true','WALG_UPLOAD_CONCURRENCY':'2','WALG_DOWNLOAD_CONCURRENCY':'2','WALG_DOWNLOAD_FILE_RETRIES':'1','WALG_S3_MAX_RETRIES':'2','WALG_SLOTNAME':c['slot'],'PGHOST':str(root/'var/run/postgresql'),'PGUSER':'barber_backup','PGPASSWORD':password,'PGDATABASE':'postgres','PGSSLMODE':'disable','RESTIC_REPOSITORY':'s3:'+ENDPOINT+'/'+BUCKET+'/production/v1/objects-v1','RESTIC_PASSWORD_FILE':'/etc/barber-backup/restic.password','RESTIC_CACHE_DIR':str(STATE/'restic-cache'),'GOMAXPROCS':'2'}
 if not re.fullmatch('[a-f0-9]{64}',private(env['RESTIC_PASSWORD_FILE'])):raise ValueError('Invalid private object encryption password')
 for tool,key in [('wal-g-v3.0.9','walgSha256'),('restic-v0.19.1','resticSha256')]:
  path=TOOLS/tool
  if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=c[key]:raise ValueError('Backup executable identity changed')
 return env,root

def perform(mode,c):
 # This guard precedes every network, Docker and database operation.
 validate(c)
 if os.getuid()!=0:raise ValueError('Privileged backup operator required')
 STATE.mkdir(mode=0o700,exist_ok=True)
 lock=os.open(STATE/(mode+'.lock'),os.O_CREAT|os.O_RDWR,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 env,root=runtime(c);walg=TOOLS/'wal-g-v3.0.9';restic=TOOLS/'restic-v0.19.1'
 issued=utc()
 if mode=='stream':
  os.set_inheritable(lock,True)
  log=pathlib.Path('/var/log/barber-backup/wal.log');log.parent.mkdir(mode=0o700,exist_ok=True)
  if log.exists() and log.stat().st_size>10*1024*1024:log.replace(log.with_suffix('.previous.log'))
  fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600);os.dup2(fd,1);os.dup2(fd,2)
  os.execve(walg,[str(walg),'wal-receive'],env)
 elif mode=='full':
  before={r['backup_name'] for r in json.loads(command([walg,'backup-list','--json'],env))}
  command([walg,'backup-push'],env,timeout=3600)
  after={r['backup_name'] for r in json.loads(command([walg,'backup-list','--json'],env))};added=after-before
  if len(added)!=1:raise ValueError('New full backup identity could not be reconciled')
  name=added.pop()
  if not re.fullmatch('base_[A-F0-9]{24}',name):raise ValueError('Unexpected full backup identity')
  atomic('base-backup.json',{'status':'FULL_BACKUP_UPLOADED','backupName':name,'systemId':c['systemId'],'startedAt':issued,'completedAt':utc()})
 elif mode=='objects':
  sources=FIXED_FILES+c['composeFiles']
  if any(not pathlib.Path(p).exists() or pathlib.Path(p).is_symlink() for p in sources):raise ValueError('Required object/configuration backup source missing or linked')
  raw=command([restic,'backup','--json','--host','srv1073968','--tag','barber-production-v1',*sources],env,timeout=1800)
  rows=[json.loads(line) for line in raw.splitlines()];summary=[r for r in rows if r.get('message_type')=='summary'][-1]
  snapshot=summary['snapshot_id']
  if not re.fullmatch('[a-f0-9]{64}',snapshot):raise ValueError('Unexpected object snapshot identity')
  atomic('object-backup.json',{'status':'OBJECT_SNAPSHOT_UPLOADED','snapshotId':snapshot,'startedAt':issued,'completedAt':utc()})
 elif mode=='pulse':
  slot=json.loads(sql("BEGIN READ ONLY; SELECT json_build_object('active',active,'type',slot_type,'walStatus',wal_status,'retainedBytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)) FROM pg_replication_slots WHERE slot_name='barber_production_recovery'; COMMIT;"))
  if slot['active'] is not True or slot['type']!='physical' or slot['walStatus']=='lost' or slot['retainedBytes']>384*1024*1024:raise ValueError('Backup replication is unhealthy or approaching its existing retention limit')
  marker='barber_backup_'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')
  rows=sql("SELECT json_build_object('lsn',lsn::text,'wal',pg_walfile_name(lsn)) FROM (SELECT pg_create_restore_point('"+marker+"') AS lsn) p; SELECT pg_switch_wal();").splitlines()
  point=json.loads(rows[0]);wal=point['wal']
  if not re.fullmatch('[A-F0-9]{24}',wal):raise ValueError('Invalid recovery WAL identity')
  data=(root/'var/lib/postgresql/data/pg_wal'/wal).read_bytes();expected=hashlib.sha256(data).hexdigest()
  if len(data)!=16777216:raise ValueError('Unexpected production WAL size')
  with tempfile.TemporaryDirectory(prefix='barber-wal-verification-',dir='/dev/shm') as d:
   path=pathlib.Path(d)/wal
   # Receiver uploads only complete WAL segments. Wait through upload latency.
   success=False
   for _ in range(12):
    try:
     command([walg,'wal-fetch',wal,path],env,timeout=30)
     if path.stat().st_size==len(data) and hashlib.sha256(path.read_bytes()).hexdigest()==expected:success=True;break
    except (RuntimeError,subprocess.TimeoutExpired):pass
    if path.exists():path.unlink()
    time.sleep(5)
   if not success:raise ValueError('Exact encrypted off-host WAL could not be recovered')
  atomic('wal-point.json',{'status':'OFF_HOST_WAL_ROUNDTRIP_VERIFIED','systemId':c['systemId'],'wal':wal,'lsn':point['lsn'],'sha256':expected,'recoverablePointCreatedAt':issued,'verifiedAt':utc()})
 else:raise ValueError('Unsupported operation')
 print(json.dumps({'status':'BACKUP_OPERATION_COMPLETE','operation':mode,'productionDatabaseMigrationPerformed':False}))

def self_test():
 c={'enabled':False}
 try:perform('full',c)
 except ValueError as e:assert str(e)=='Production backup activation is disabled'
 else:raise AssertionError('Disabled backup was accepted')
 c={'enabled':True,'host':'srv1073968','bucket':BUCKET,'endpoint':ENDPOINT,'prefix':'production/v1/','role':'barber_backup','slot':'barber_production_recovery','systemId':'7500000000000000000','originalHbaSha256':'a'*64,'composeFiles':['/root/supabase/docker/docker-compose.yml'],'walgSha256':'8015836f246a978f27b31a2462eac7765312558ae5b11ac033322b555abf9e22','resticSha256':'20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'}
 validate(c);count=0
 for key,value in [('enabled',1),('endpoint','http://s3.us-east-005.backblazeb2.com'),('bucket','other'),('prefix',''),('role','supabase_admin'),('slot','other'),('composeFiles',['/root/unrelated.yml']),('composeFiles',['/root/supabase/docker/../../unrelated.yml']),('walgSha256','a'*64),('systemId','; SQL')]:
  bad=dict(c);bad[key]=value
  try:validate(bad)
  except ValueError:count+=1;continue
  raise AssertionError('Unreviewed backup configuration accepted')
 print(json.dumps({'status':'PREPARED_BACKUP_GUARDS_PASS','unsafeConfigurationsRejected':count,'disabledGuardBeforeExternalOperations':True,'externalOperations':0}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['self-test','stream','full','objects','pulse']);a=p.parse_args()
 try:
  if a.mode=='self-test':self_test()
  else:perform(a.mode,json.loads(private(CONFIG)))
 except Exception as e:
  print(json.dumps({'status':'BACKUP_OPERATION_BLOCKED','reason':str(e) if isinstance(e,(ValueError,RuntimeError)) else type(e).__name__,'credentialValuesPrinted':False}),file=sys.stderr);sys.exit(1)
