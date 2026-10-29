"""Safety checks use synthetic metadata; never contact production or B2."""
import copy,datetime,importlib.util,json,pathlib,unittest
from unittest import mock
import runtime,readiness,scope

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('policy',ROOT/'ops/release/backup_policy.py');policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)

class BackupSafety(unittest.TestCase):
 def config(self):
  c=json.loads((pathlib.Path(__file__).parent/'config.example.json').read_text());c.update(enabled=True,systemId='7500000000000000000',originalHbaSha256='a'*64);return c

 def fixture(self):
  now=datetime.datetime(2026,1,2,tzinfo=datetime.timezone.utc)
  stamp=lambda seconds:(now-datetime.timedelta(seconds=seconds)).isoformat()
  c=self.config();base={'status':'FULL_BACKUP_UPLOADED','systemId':c['systemId'],'startedAt':stamp(3600)};obj={'status':'OBJECT_SNAPSHOT_UPLOADED','startedAt':stamp(120)};wal={'status':'OFF_HOST_WAL_ROUNDTRIP_VERIFIED','systemId':c['systemId'],'recoverablePointCreatedAt':stamp(90)}
  drill={'status':'REAL_B2_PHYSICAL_PITR_AND_STORAGE_RESTORE_PASS','systemId':c['systemId'],'recoveryDatabase':{'recoveryComplete':True},'plaintextRecoveryTargetRemoved':True,'disposableContainerRemoved':True,'network':'none','publishedPorts':0,'productionDatabaseRestoredOver':False,'productionDataEnteredLocalTest':False,'productionEnvAndComposeMatched':True,'fileTreesMatched':{path:{'files':1,'sha256':'a'*64} for path in ['/root/supabase/docker/volumes/storage','/root/supabase/docker/volumes/functions','/var/lib/docker/volumes/supabase_db-config/_data']},'completedAt':stamp(86400),'achievedRpoSeconds':12,'achievedRtoSeconds':29}
  return c,base,obj,wal,drill,now

 def test_disabled_configuration_precedes_all_external_operations(self):
  for value in [False,1,'true',None]:
   with self.subTest(value=value),mock.patch.object(runtime,'runtime') as external,mock.patch.object(runtime.STATE.__class__,'mkdir') as mkdir:
    c=self.config();c['enabled']=value
    with self.assertRaisesRegex(ValueError,'activation is disabled'):runtime.perform('full',c)
    external.assert_not_called();mkdir.assert_not_called()

 def test_other_destinations_accounts_paths_and_executables_are_refused(self):
  for key,value in [('bucket','unrelated'),('prefix',''),('endpoint','http://s3.us-east-005.backblazeb2.com'),('role','supabase_admin'),('slot','shared_slot'),('systemId','7500;SQL'),('composeFiles',['/root/unrelated.yml']),('composeFiles',['/root/supabase/docker/../../unrelated.yml']),('resticSha256','a'*64),('walgSha256','a'*64)]:
   with self.subTest(key=key,value=value):
    c=self.config();c[key]=value
    with self.assertRaises(ValueError):runtime.validate(c)

 def test_measured_evidence_satisfies_the_unmodified_release_policy(self):
  c,base,obj,wal,drill,now=self.fixture();e=readiness.measured(c,base,obj,wal,drill,now)
  self.assertEqual(e['recoverable_point_age_seconds'],120)
  self.assertEqual(e['base_backup']['age_seconds'],3600)
  policy.verify_backup_readiness(e,now.timestamp())

 def test_report_refresh_cannot_refresh_the_actual_backup_age(self):
  c,base,obj,wal,drill,now=self.fixture();later=now+datetime.timedelta(seconds=1000)
  e=readiness.measured(c,base,obj,wal,drill,later)
  self.assertEqual(e['recoverable_point_age_seconds'],1120)
  with self.assertRaises(ValueError):policy.verify_backup_readiness(e,later.timestamp())

 def test_failed_partial_or_unisolated_drill_is_not_normalized_to_success(self):
  for key,value in [('status','PASS'),('plaintextRecoveryTargetRemoved',False),('plaintextRecoveryTargetRemoved',1),('disposableContainerRemoved',1),('publishedPorts',False),('publishedPorts',5432),('network','host'),('productionDatabaseRestoredOver',True),('productionEnvAndComposeMatched',False),('productionDataEnteredLocalTest',True)]:
   with self.subTest(key=key,value=value):
    c,base,obj,wal,drill,now=self.fixture();drill[key]=value
    with self.assertRaises(ValueError):readiness.measured(c,base,obj,wal,drill,now)

 def test_storage_config_and_functions_restore_hashes_are_required(self):
  for source in self.fixture()[4]['fileTreesMatched']:
   for value in [None,{}, {'files':True,'sha256':'a'*64},{'files':1,'sha256':'unverified'}]:
    with self.subTest(source=source,value=value):
     c,base,obj,wal,drill,now=self.fixture();drill['fileTreesMatched'][source]=value
     with self.assertRaises(ValueError):readiness.measured(c,base,obj,wal,drill,now)

 def test_wrong_database_identity_and_future_timestamps_are_refused(self):
  c,base,obj,wal,drill,now=self.fixture();drill['systemId']='other'
  with self.assertRaises(ValueError):readiness.measured(c,base,obj,wal,drill,now)
  c,base,obj,wal,drill,now=self.fixture();obj['startedAt']=(now+datetime.timedelta(seconds=1)).isoformat()
  with self.assertRaises(ValueError):readiness.measured(c,base,obj,wal,drill,now)

 def test_wal_rollover_requires_every_complete_remote_segment(self):
  a='base_0000000100000000000000FE';b='000000010000000100000001'
  names=['0000000100000000000000FE.zst','0000000100000000000000FF.zst','000000010000000100000000.zst','000000010000000100000001.zst']
  self.assertEqual(readiness.continuity(a,b,names),4)
  for index in range(4):
   bad=names[:];bad[index]+='.tmp'
   with self.subTest(index=index),self.assertRaises(ValueError):readiness.continuity(a,b,bad)
  with self.assertRaises(ValueError):readiness.continuity(a,'000000020000000100000001',names)
  with self.assertRaises(ValueError):readiness.continuity(a,'000000010000000100000100',names)

 def test_account_wide_keys_redirects_and_unbounded_keys_are_rejected(self):
  now=1800000000
  auth={'apiInfo':{'storageApi':{'apiUrl':'https://api005.backblazeb2.com','s3ApiUrl':scope.ENDPOINT,'allowed':{'buckets':[{'id':scope.BUCKET_ID,'name':scope.BUCKET}],'namePrefix':scope.PREFIX,'capabilities':['listBuckets','listFiles','readFiles','writeFiles','deleteFiles','listAllBucketNames']}}},'applicationKeyExpirationTimestamp':(now+86400)*1000}
  scope.validate_scope(auth,now)
  variants=[]
  for field,value in [('buckets',None),('buckets',[{'id':'other'}]),('namePrefix',''),('capabilities',['writeKeys'])]:
   bad=copy.deepcopy(auth);bad['apiInfo']['storageApi']['allowed'][field]=value;variants.append(bad)
  for url in ['http://api005.backblazeb2.com','https://api005.backblazeb2.com.evil.invalid','https://attacker@api005.backblazeb2.com','https://api005.backblazeb2.com:444']:
   bad=copy.deepcopy(auth);bad['apiInfo']['storageApi']['apiUrl']=url;variants.append(bad)
  for expiry in [None,now-1,(now+91*86400)*1000]:
   bad=copy.deepcopy(auth);bad['applicationKeyExpirationTimestamp']=expiry;variants.append(bad)
  for bad in variants:
   with self.subTest(auth=bad),self.assertRaises(ValueError):scope.validate_scope(bad,now)
  self.assertIsNone(scope.NoRedirect().redirect_request(None,None,None,None,None,None))

if __name__=='__main__':unittest.main()
