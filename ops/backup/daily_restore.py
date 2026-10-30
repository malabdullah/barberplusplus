"""One actual encrypted physical/WAL/files recovery drill; no production writes."""

def run():
    
    import pathlib,subprocess,json,os,sys,hashlib,tempfile,time,datetime,shutil,re,importlib.util
    import runtime as m
    c=json.loads(m.private(m.CONFIG));env,source_root=m.runtime(c)
    m.PG_IMAGE='sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
    name='barber-production-daily-b2-drill'
    assert subprocess.run(['docker','inspect',name],capture_output=True).returncode!=0
    assert shutil.disk_usage('/dev/shm').free>=1024**3
    start=time.monotonic();failure_at=datetime.datetime.now(datetime.timezone.utc)
    base=pathlib.Path(tempfile.mkdtemp(prefix='barber-daily-recovery-',dir='/dev/shm'));base.chmod(0o700)
    created=False
    lease=m.STATE/'daily-restore-lease.json'
    if lease.exists():raise ValueError('Unreconciled daily restore lease')
    lease.write_text(json.dumps({'directory':str(base),'container':name}));lease.chmod(0o600)
    progress=pathlib.Path('/var/lib/barber-r2-backup/restore-drill-progress.json')
    def stage(value):
     progress.write_text(json.dumps({'stage':value,'at':m.utc()}));progress.chmod(0o600)
    def run(args,timeout=180,env=None,strict=True):
     p=subprocess.run([str(a) for a in args],text=True,capture_output=True,timeout=timeout,env=env)
     if strict and p.returncode:
      log=m.STATE/'real-restore-private-error.log';log.write_text(p.stdout+'\n'+p.stderr);log.chmod(0o600)
      raise RuntimeError('Recovery operation failed; protected diagnostic log retained')
     return p
    try:
     failure_at=datetime.datetime.now(datetime.timezone.utc)
     b=json.loads((m.STATE/'base-backup.json').read_text());o=json.loads((m.STATE/'object-backup.json').read_text());w=json.loads((m.STATE/'wal-point.json').read_text())
     assert b['systemId']==w['systemId']==c['systemId']
     rpo=max((failure_at-datetime.datetime.fromisoformat(x)).total_seconds() for x in [o['startedAt'],w['recoverablePointCreatedAt']]);assert 0<=rpo<=900
     stage('download-encrypted-base-and-files')
     run([m.TOOLS/'wal-g-v3.0.9','backup-fetch',base/'data',b['backupName']],env=env)
     run([m.TOOLS/'restic-v0.19.1','restore',o['snapshotId'],'--target',base/'objects'],env=env)
     # Restore authenticates every downloaded chunk; avoid rescanning historical snapshots.
     lower=b['backupName'].removeprefix('base_');upper=w['wal']
     assert re.fullmatch('[A-F0-9]{24}',lower) and re.fullmatch('[A-F0-9]{24}',upper) and lower[:8]==upper[:8]
     def sequence(wal):
      assert int(wal[16:],16)<256
      return int(wal[8:16],16)*256+int(wal[16:],16)
     lo,hi=sequence(lower),sequence(upper);assert 0<=hi-lo<4096
     wal_dir=base/'wal';wal_dir.mkdir(mode=0o700)
     for seq in range(lo,hi+1):
      wal=lower[:8]+format(seq//256,'08X')+format(seq%256,'08X')
      run([m.TOOLS/'wal-g-v3.0.9','wal-fetch',wal,wal_dir/wal],env=env)
      assert (wal_dir/wal).stat().st_size==16777216
     assert hashlib.sha256((wal_dir/upper).read_bytes()).hexdigest()==w['sha256']
     stage('verify-restored-storage-functions-and-config')
     def treehash(path):
      entries=[]
      for p in sorted(path.rglob('*')):
       relative=str(p.relative_to(path))
       if p.is_symlink():entries.append((relative,'link',os.readlink(p)))
       elif p.is_file():entries.append((relative,'file',hashlib.sha256(p.read_bytes()).hexdigest()))
      return hashlib.sha256(json.dumps(entries,separators=(',',':')).encode()).hexdigest(),sum(1 for e in entries if e[1]=='file')
     matched={}
     for path in ['/root/supabase/docker/volumes/storage','/root/supabase/docker/volumes/functions','/var/lib/docker/volumes/supabase_db-config/_data']:
      live=pathlib.Path(path);restored=base/'objects'/path.lstrip('/')
      actual,count=treehash(restored);expected,live_count=treehash(live);assert actual==expected and count==live_count
      matched[path]={'files':count,'sha256':actual}
     for path in ['/root/supabase/docker/.env',*c['composeFiles']]:assert (base/'objects'/path.lstrip('/')).read_bytes()==pathlib.Path(path).read_bytes()
     uid=int(run(['docker','exec','supabase-db','id','-u','postgres']).stdout);gid=int(run(['docker','exec','supabase-db','id','-g','postgres']).stdout)
     os.chown(base,uid,gid)
     for directory in [base/'data',wal_dir]:
      for p in [directory,*list(directory.rglob('*'))]:
       if not p.is_symlink():os.chown(p,uid,gid)
     hba=base/'drill-hba.conf';hba.write_text('local all all trust\n');os.chown(hba,uid,gid)
     ident=base/'drill-ident.conf';ident.touch();os.chown(ident,uid,gid)
     signal=base/'data'/'recovery.signal';signal.touch();os.chown(signal,uid,gid)
     assert not (base/'data'/'standby.signal').exists()
     config_dir=base/'objects/var/lib/docker/volumes/supabase_db-config/_data'
     args=['docker','run','-d','--name',name,'--no-healthcheck','--network','none','--memory','1g','--cpus','1','--user','postgres','--mount','type=bind,src='+str(base)+',dst=/recovery','--mount','type=bind,src='+str(config_dir)+',dst=/etc/postgresql-custom,readonly','--entrypoint','postgres',m.PG_IMAGE,'-D','/recovery/data','-c','config_file=/etc/postgresql/postgresql.conf','-c','data_directory=/recovery/data','-c','hba_file=/recovery/drill-hba.conf','-c','ident_file=/recovery/drill-ident.conf','-c','listen_addresses=','-c','unix_socket_directories=/tmp','-c','ssl=off','-c','shared_preload_libraries=pg_cron,pg_stat_statements','-c','cron.database_name=postgres','-c','cron.launch_active_jobs=off','-c','archive_mode=off','-c','primary_conninfo=','-c','primary_slot_name=','-c','restore_command=cp /recovery/wal/%f %p','-c','recovery_target_lsn='+w['lsn'],'-c','recovery_target_action=promote']
     stage('recover-isolated-database-to-verified-lsn');run(args);created=True
     for _ in range(50):
      if run(['docker','exec',name,'pg_isready','-h','/tmp','-U','supabase_admin'],strict=False).returncode==0:break
      time.sleep(1)
     else:
      p=run(['docker','logs','--tail','50',name],strict=False);f=m.STATE/'pitr-startup-private-error.log';f.write_text(p.stdout+'\n'+p.stderr);f.chmod(0o600);raise RuntimeError('Isolated physical recovery did not become ready')
     def sql(q):return run(['docker','exec',name,'psql','-h','/tmp','-U','supabase_admin','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-c',q]).stdout.strip()
     info=json.loads(sql("SELECT json_build_object('systemId',(SELECT system_identifier::text FROM pg_control_system()),'recoveryComplete',NOT pg_is_in_recovery(),'authUsers',(SELECT count(*) FROM auth.users),'publicTables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),'rlsTables',(SELECT count(*) FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relkind='r' AND relrowsecurity),'storageObjectRecords',(SELECT count(*) FROM storage.objects),'postgresIsSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'));"))
     assert info['systemId']==c['systemId'] and info['recoveryComplete'] and info['authUsers']>0 and info['publicTables']>0 and info['publicTables']==info['rlsTables'] and not info['postgresIsSuperuser']
     spec=importlib.util.spec_from_file_location('normalizer','/usr/local/lib/barber-release/normalize-schema.py');normalizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(normalizer)
     script='pg_dump() { docker exec '+name+' pg_dump -h /tmp -U postgres -d postgres "$@"; }; export -f pg_dump; exec bash /usr/local/lib/barber-release/dump-schema.sh'
     dumpenv=dict(os.environ,PGHOST='',PGPORT='',PGUSER='',PGPASSWORD='',PGDATABASE='',EXTRA_FLAGS='--schema public',EXTRA_SED='/^--/d')
     dumped=run(['bash','-c',script],env=dumpenv).stdout
     fingerprint=hashlib.sha256(normalizer.behavioral_schema(dumped).encode()).hexdigest()
     live_dump=run(['bash','/usr/local/lib/barber-release/dump-production-schema.sh']).stdout
     live_fingerprint=hashlib.sha256(normalizer.behavioral_schema(live_dump).encode()).hexdigest();assert fingerprint==live_fingerprint
     state=json.loads(run(['docker','inspect',name]).stdout)[0];assert state['HostConfig']['NetworkMode']=='none' and not state['HostConfig']['PortBindings']
     elapsed=round(time.monotonic()-start,2);assert elapsed<=7200
     result={'status':'REAL_B2_PHYSICAL_PITR_AND_STORAGE_RESTORE_PASS','systemId':c['systemId'],'baseBackup':b['backupName'],'objectSnapshot':o['snapshotId'],'restoredWalSegments':hi-lo+1,'verifiedRecoveryLsn':w['lsn'],'recoverablePointCreatedAt':w['recoverablePointCreatedAt'],'recoveryDatabase':info,'publicSchemaOwnershipAndAclFingerprint':fingerprint,'fileTreesMatched':matched,'productionEnvAndComposeMatched':True,'encryptedOffHostSource':'private B2 production/v1/ repositories','network':'none','publishedPorts':0,'cronLaunchEnabled':False,'netBackgroundWorkerEnabled':False,'productionDatabaseRestoredOver':False,'productionDataEnteredLocalTest':False,'achievedRpoSeconds':round(rpo,2),'achievedRtoSeconds':elapsed,'completedAt':m.utc()}
    finally:
     if created:run(['docker','rm','-f',name],strict=False)
     assert base.parent==pathlib.Path('/dev/shm') and base.name.startswith('barber-daily-recovery-');shutil.rmtree(base)
    lease.unlink();result['plaintextRecoveryTargetRemoved']=not base.exists();result['disposableContainerRemoved']=subprocess.run(['docker','inspect',name],capture_output=True).returncode!=0
    assert result['plaintextRecoveryTargetRemoved'] and result['disposableContainerRemoved']
    f=m.STATE/'restore-drill.json';f.write_text(json.dumps(result,indent=2)+'\n');f.chmod(0o600);stage('complete');return result
