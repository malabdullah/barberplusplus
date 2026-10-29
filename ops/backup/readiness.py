"""Generate strict readiness only from measured, independently checked backups."""
import argparse,base64,datetime,hashlib,importlib.util,json,os,pathlib,re,sys,tempfile,time,urllib.request
import runtime as m
import scope
EVIDENCE=pathlib.Path('/etc/barber-release/backup-readiness.json')

def age(value,now):
 d=datetime.datetime.fromisoformat(value)
 if d.tzinfo is None:raise ValueError('Backup timestamp must be timezone aware')
 seconds=(now-d).total_seconds()
 if seconds<0:raise ValueError('Future backup timestamp refused')
 return seconds

def continuity(backup,point,names):
 a=backup.removeprefix('base_');b=point
 if not re.fullmatch('[A-F0-9]{24}',a) or not re.fullmatch('[A-F0-9]{24}',b) or a[:8]!=b[:8]:raise ValueError('Reviewed WAL timeline changed')
 def seq(s):
  if int(s[16:],16)>=256:raise ValueError('Unexpected WAL segment size')
  return int(s[8:16],16)*256+int(s[16:],16)
 lo,hi=seq(a),seq(b)
 if not 0<=hi-lo<4096:raise ValueError('Unexpected WAL recovery range')
 required={a[:8]+format(n//256,'08X')+format(n%256,'08X')+'.zst' for n in range(lo,hi+1)}
 if not required<=set(names):raise ValueError('Off-host WAL continuity gap')
 return len(required)

def measured(c,base,obj,wal,drill,now):
 if base['status']!='FULL_BACKUP_UPLOADED' or obj['status']!='OBJECT_SNAPSHOT_UPLOADED' or wal['status']!='OFF_HOST_WAL_ROUNDTRIP_VERIFIED':raise ValueError('Successful backup receipt missing')
 if base['systemId']!=wal['systemId'] or wal['systemId']!=drill['systemId'] or drill['systemId']!=c['systemId']:raise ValueError('Backup or drill database identity mismatch')
 if drill['status']!='REAL_B2_PHYSICAL_PITR_AND_STORAGE_RESTORE_PASS' or drill['recoveryDatabase']['recoveryComplete'] is not True or drill['plaintextRecoveryTargetRemoved'] is not True or drill['disposableContainerRemoved'] is not True:raise ValueError('Actual completed recovery drill required')
 if drill['network']!='none' or type(drill['publishedPorts']) is not int or drill['publishedPorts']!=0 or drill['productionDatabaseRestoredOver'] is not False or drill['productionDataEnteredLocalTest'] is not False:raise ValueError('Recovery isolation proof required')
 if drill.get('productionEnvAndComposeMatched') is not True:raise ValueError('Configuration restoration not verified')
 for source in ['/root/supabase/docker/volumes/storage','/root/supabase/docker/volumes/functions','/var/lib/docker/volumes/supabase_db-config/_data']:
  proof=drill['fileTreesMatched'].get(source)
  if not isinstance(proof,dict) or type(proof.get('files')) is not int or proof['files']<0 or not re.fullmatch('[a-f0-9]{64}',proof.get('sha256','')):raise ValueError('File restoration fingerprint missing')
 wa=age(wal['recoverablePointCreatedAt'],now);oa=age(obj['startedAt'],now);ba=age(base['startedAt'],now)
 return {'checked_at':now.isoformat(),'offsite_destination':True,'recoverable_point_age_seconds':max(wa,oa),'wal_archive':{'healthy':True,'lag_seconds':wa},'base_backup':{'healthy':True,'age_seconds':ba},'object_backup':{'healthy':True,'age_seconds':oa},'latest_restore_drill':{'completed_at':drill['completedAt'],'database_restored':True,'storage_restored':True,'achieved_rpo_seconds':drill['achievedRpoSeconds'],'achieved_rto_seconds':drill['achievedRtoSeconds']}}

def write(path,value):
 if path.is_symlink():raise ValueError('Unexpected evidence link')
 fd,temp=tempfile.mkstemp(prefix='.backup-evidence-',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)

def once():
 c=json.loads(m.private(m.CONFIG));m.validate(c);env,root=m.runtime(c)
 binding=json.loads(m.private(m.STATE/'repository-binding.json'))
 if binding['systemId']!=c['systemId'] or binding['databasePrefix']!='production/v1/pg17-'+c['systemId']+'/' or binding['objectPrefix']!='production/v1/objects-v1/':raise ValueError('Backup repository binding differs from review')
 creds=json.loads(m.private('/etc/barber-backup/b2.json'));opener=urllib.request.build_opener(scope.NoRedirect)
 def request(url,headers,body=None):
  req=urllib.request.Request(url,headers=headers,data=None if body is None else json.dumps(body).encode())
  with opener.open(req,timeout=30) as response:return json.load(response)
 auth=request('https://api.backblazeb2.com/b2api/v4/b2_authorize_account',{'Authorization':'Basic '+base64.b64encode((creds['key_id'].strip()+':'+creds['application_key'].strip()).encode()).decode()})
 storage,caps,expires=scope.validate_scope(auth)
 def call(action,data):return request(storage['apiUrl']+'/b2api/v4/'+action,{'Authorization':auth['authorizationToken'],'Content-Type':'application/json'},data)
 buckets=call('b2_list_buckets',{'accountId':auth['accountId'],'bucketId':scope.BUCKET_ID})['buckets']
 if len(buckets)!=1 or buckets[0]['bucketName']!=m.BUCKET or buckets[0]['bucketType']!='allPrivate':raise ValueError('Expected private production recovery bucket')
 base=json.loads(m.private(m.STATE/'base-backup.json'));obj=json.loads(m.private(m.STATE/'object-backup.json'));wal=json.loads(m.private(m.STATE/'wal-point.json'));drill=json.loads(m.private(m.STATE/'restore-drill.json'))
 backups=json.loads(m.command([m.TOOLS/'wal-g-v3.0.9','backup-list','--json'],env))
 if base['backupName'] not in {row['backup_name'] for row in backups}:raise ValueError('Current full backup absent from off-host catalog')
 object_cfg=json.loads(m.command([m.TOOLS/'restic-v0.19.1','cat','config'],env))
 if object_cfg['id']!=binding['objectRepositoryId']:raise ValueError('Object repository identity mismatch')
 snapshots=json.loads(m.command([m.TOOLS/'restic-v0.19.1','snapshots','--json'],env))
 if obj['snapshotId'] not in {s['id'] for s in snapshots if s.get('hostname')=='srv1073968' and 'barber-production-v1' in s.get('tags',[])}:raise ValueError('Current object snapshot absent from off-host catalog')
 prefix=binding['databasePrefix']+'wal_005/';names=[];start=prefix+base['backupName'].removeprefix('base_')+'.zst'
 for _ in range(100):
  query={'bucketId':scope.BUCKET_ID,'prefix':prefix,'maxFileCount':1000}
  if start is not None:query['startFileName']=start
  page=call('b2_list_file_names',query)
  for item in page['files']:
   if not item['fileName'].startswith(prefix):raise ValueError('Provider returned object outside exact WAL prefix')
   names.append(item['fileName'][len(prefix):])
  if any(name >= wal['wal']+'.zst' for name in names):break
  next_name=page.get('nextFileName')
  if next_name is None:break
  if next_name==start or not next_name.startswith(prefix):raise ValueError('Invalid WAL listing continuation')
  start=next_name
 else:raise ValueError('WAL catalog exceeds reviewed scan limit')
 segments=continuity(base['backupName'],wal['wal'],names)
 slot=json.loads(m.sql("BEGIN READ ONLY; SELECT json_build_object('active',active,'type',slot_type,'walStatus',wal_status,'retainedBytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)) FROM pg_replication_slots WHERE slot_name='barber_production_recovery'; COMMIT;"))
 if not slot or slot['active'] is not True or slot['type']!='physical' or slot['walStatus']=='lost' or slot['retainedBytes']>384*1024*1024:raise ValueError('Physical backup slot unhealthy or nearing retention limit')
 now=datetime.datetime.now(datetime.timezone.utc);e=measured(c,base,obj,wal,drill,now)
 spec=importlib.util.spec_from_file_location('backup_policy','/usr/local/lib/barber-release/backup_policy.py');policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
 policy.verify_backup_readiness(e,now=now.timestamp())
 e.update(status='MEASURED_OFF_HOST_RECOVERY_HEALTHY',proof={'systemId':c['systemId'],'baseBackup':base['backupName'],'objectSnapshot':obj['snapshotId'],'wal':wal['wal'],'contiguousWalSegmentsVerified':segments,'slotRetainedBytes':slot['retainedBytes'],'keyExpiresAt':datetime.datetime.fromtimestamp(expires,datetime.timezone.utc).isoformat(),'privateBucketAndScopeReverified':True,'offHostCatalogsReverified':True},operatingConditions=['First application cutover still requires acceptance','New repository retention and independent recovery-key safekeeping await review'])
 write(EVIDENCE,e);print(json.dumps({'status':e['status'],'recoverablePointAgeSeconds':round(e['recoverable_point_age_seconds'],2),'baseBackupAgeSeconds':round(e['base_backup']['age_seconds'],2),'objectBackupAgeSeconds':round(e['object_backup']['age_seconds'],2),'contiguousWalSegmentsVerified':segments,'automaticApplicationReleaseEnabled':False}))

def self_test():
 first='base_0000000100000000000000FE';last='000000010000000100000001'
 names=['0000000100000000000000FE.zst','0000000100000000000000FF.zst','000000010000000100000000.zst','000000010000000100000001.zst'];assert continuity(first,last,names)==4
 for bad in [names[1:],names[:-1],names[:2]+names[3:]]:
  try:continuity(first,last,bad)
  except ValueError:continue
  raise AssertionError('A WAL gap was accepted')
 try:continuity(first,'000000020000000100000001',names)
 except ValueError:pass
 else:raise AssertionError('A different timeline was accepted')
 now=datetime.datetime.now(datetime.timezone.utc)
 try:age((now+datetime.timedelta(seconds=1)).isoformat(),now)
 except ValueError:pass
 else:raise AssertionError('Future backup accepted')
 print(json.dumps({'status':'READINESS_CONTINUITY_GUARDS_PASS','gapCasesRejected':3,'timelineChangeRejected':True,'futureTimestampRejected':True,'externalCalls':0}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['self-test','once']);a=p.parse_args()
 try:
  if a.mode=='self-test':self_test()
  else:once()
 except Exception as error:
  if a.mode=='once' and os.getuid()==0 and EVIDENCE.parent.exists():write(EVIDENCE,{'status':'BACKUP_READINESS_BLOCKED','checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'offsite_destination':False,'reason':str(error) if isinstance(error,ValueError) else type(error).__name__})
  print(json.dumps({'status':'BACKUP_READINESS_BLOCKED','reason':str(error) if isinstance(error,ValueError) else type(error).__name__,'credentialValuesPrinted':False}),file=sys.stderr);sys.exit(1)
