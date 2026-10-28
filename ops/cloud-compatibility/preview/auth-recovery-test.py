"""Dummy config/data snapshots only. Never native control, login or credentials."""
import importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch, Mock
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('authrouting',Path(__file__).with_name('auth-origin.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
RAW=b'''project_id="dummy"
[api]
port=55321
[auth]
site_url="http://127.0.0.1:55173"
additional_redirect_urls=[]
[edge_runtime.secrets]
APP_URL="http://127.0.0.1:55173"
'''
RID='barber-'+'a'*24
bs=importlib.util.spec_from_file_location('bootstrap',Path(__file__).with_name('credential-bootstrap.py'));bootstrap=importlib.util.module_from_spec(bs);bs.loader.exec_module(bootstrap)
class RecoveryTests(unittest.TestCase):
 def test_parent_restores_current_reference_after_runner_exit(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);(root/'routing-recovery-reference.json').write_text(json.dumps({'resourceId':RID}))
   command=Mock(return_value=SimpleNamespace(returncode=0))
   bootstrap.restore_profile_routing(SimpleNamespace(root=root,command=command))
   command.assert_called_once()
   args=command.call_args.args[0]
   self.assertIn('restore',args);self.assertEqual(args[-1],str(root))
   self.assertFalse((root/'auth-config-original').exists())
 def test_parent_skips_already_restored_routing(self):
  with tempfile.TemporaryDirectory()as d:
   command=Mock();bootstrap.restore_profile_routing(SimpleNamespace(root=Path(d),command=command))
   command.assert_not_called()
 def test_parent_surfaces_failed_restore(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);(root/'routing-recovery-reference.json').write_text(json.dumps({'resourceId':RID}))
   with self.assertRaises(bootstrap.StageFailure):
    bootstrap.restore_profile_routing(SimpleNamespace(root=root,command=Mock(return_value=SimpleNamespace(returncode=1))))
   self.assertTrue((root/'routing-recovery-reference.json').exists())
 def test_restore_allows_legitimate_crud_since_apply(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);root.chmod(0o700);cfg=root/'config.toml';cfg.write_bytes(RAW);state={'users':5,'bookings':1,'cron':'off','public_data_hash':'old','profile_nonce':'a'*64}
   with patch.object(a,'ROOT',root),patch.object(a,'CONFIG',cfg),patch.object(a,'snapshot',side_effect=lambda:dict(state)),patch.object(a,'reconcile'):
    a.apply_routing('https://opaque.use.devtunnels.ms',RID)
    state.update(users=6,bookings=2,public_data_hash='new-synthetic-data')
    a.restore_recovery(RID)
    self.assertEqual(cfg.read_bytes(),RAW);self.assertEqual(state['bookings'],2);self.assertFalse(a.recovery_dir(RID).exists())
 def test_failed_restore_retains_config_only_then_recovers(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);root.chmod(0o700);cfg=root/'config.toml';cfg.write_bytes(RAW);snapshot={'users':5,'bookings':1,'cron':'off','public_data_hash':'dummy','profile_nonce':'a'*64}
   with patch.object(a,'ROOT',root),patch.object(a,'CONFIG',cfg),patch.object(a,'snapshot',return_value=snapshot):
    with patch.object(a,'reconcile'):a.apply_routing('https://opaque.use.devtunnels.ms',RID)
    with patch.object(a,'reconcile',side_effect=RuntimeError('SYNTHETIC_RESTORE_FAILURE')):
     with self.assertRaises(RuntimeError):a.restore_recovery(RID)
    ram=Path(tempfile.mkdtemp(prefix='barber-owner-DUMMY-'));(ram/'dummy-cache').write_text('SYNTHETIC_ONLY');profile=bootstrap.Profile({});profile.root=ram;profile.__exit__(None,None,None);self.assertFalse(ram.exists())
    p=a.recovery_dir(RID);self.assertEqual({x.name for x in p.iterdir()},{'original-config','receipt.json'});self.assertEqual((p/'original-config').read_bytes(),RAW);self.assertEqual(p.stat().st_mode&0o777,0o700)
    self.assertTrue(all(x.stat().st_mode&0o777==0o600 for x in p.iterdir()))
    with patch.object(a,'reconcile'):a.restore_recovery(RID)
    self.assertFalse(p.exists());self.assertEqual(cfg.read_bytes(),RAW)
 def test_unknown_config_change_refused(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);root.chmod(0o700);cfg=root/'config.toml';cfg.write_bytes(RAW);snapshot={'cron':'off','profile_nonce':'a'*64}
   with patch.object(a,'ROOT',root),patch.object(a,'CONFIG',cfg),patch.object(a,'snapshot',return_value=snapshot),patch.object(a,'reconcile'):
    a.apply_routing('https://opaque.use.devtunnels.ms',RID);cfg.write_bytes(RAW+b'\n# concurrent change\n')
    with self.assertRaises(ValueError):a.restore_recovery(RID)
    self.assertTrue(a.recovery_dir(RID).exists())
unittest.main()
