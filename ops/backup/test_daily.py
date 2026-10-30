import copy, datetime, importlib.util, pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import daily
spec = importlib.util.spec_from_file_location('policy', pathlib.Path(__file__).parents[1]/'release/backup_policy.py')
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
NOW = 1803916800
STAMP = datetime.datetime.fromtimestamp(NOW-600, datetime.timezone.utc).isoformat()
E = {'policy':'daily-v1','provider':'b2','system_id':'7500000000000000000','captured_at':STAMP,'verified_at':STAMP,'base_backup':'base_000000010000000000000001','object_snapshot':'a'*64,'recovery_lsn':'0/123','repository':'private B2','encrypted_offsite':True,'database_restored':True,'storage_restored':True,'functions_restored':True,'configuration_restored':True,'isolated_target_removed':True,'restore_seconds':30}

class DailyTests(unittest.TestCase):
    def verify(self,e,commit=None): p.verify_backup_readiness(e,now=NOW,release_commit=commit,system_id=E['system_id'])
    def test_current_daily(self): self.verify(E)
    def test_missing_identity(self):
        with self.assertRaises(ValueError): p.verify_backup_readiness(E,now=NOW)
    def test_stale_and_future_cannot_refresh(self):
        for field in ['captured_at','verified_at']:
            for offset in [-27*3600,60]:
                e=copy.deepcopy(E); e[field]=datetime.datetime.fromtimestamp(NOW+offset,datetime.timezone.utc).isoformat()
                with self.assertRaises(ValueError): self.verify(e)
    def test_incomplete_or_unbound(self):
        for key,value in [('system_id','other'),('provider','other'),('database_restored',1),('storage_restored',False),('functions_restored',False),('configuration_restored',False),('isolated_target_removed',False),('restore_seconds',float('nan')),('restore_seconds',7201),('object_snapshot','')]:
            e=copy.deepcopy(E);e[key]=value
            with self.assertRaises(ValueError):self.verify(e)
    def test_transition_exact_release_and_expiry(self):
        e=copy.deepcopy(E);e.update(provider='r2-transition',release_commit='c'*40,expires_at=datetime.datetime.fromtimestamp(NOW+3600,datetime.timezone.utc).isoformat())
        self.verify(e,'c'*40)
        for commit in [None,'b'*40]:
            with self.assertRaises(ValueError):self.verify(e,commit)
        for offset in [-1,27*3600]:
            e['expires_at']=datetime.datetime.fromtimestamp(NOW+offset,datetime.timezone.utc).isoformat()
            with self.assertRaises(ValueError):self.verify(e,'c'*40)
    def test_every_failure_cleans_stream(self):
        for failure in ['stream','full','objects','pulse','restore']:
            events=[]
            def invoke(mode):
                events.append(mode)
                if mode==failure:raise RuntimeError()
            def restore():invoke('restore')
            with self.assertRaises(RuntimeError):daily.cycle(invoke,restore,lambda:events.append('cleanup'))
            self.assertEqual(events[-1],'cleanup')
    def test_order_and_single_cycle(self):
        events=[]
        self.assertEqual(daily.cycle(events.append,lambda:events.append('restore') or 'proof',lambda:events.append('cleanup')),'proof')
        self.assertEqual(events,['stream','full','objects','pulse','restore','cleanup'])

if __name__=='__main__':unittest.main()
