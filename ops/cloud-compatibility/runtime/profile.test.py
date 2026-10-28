import importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cloudprofile',Path(__file__).with_name('profile.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class SafetyTests(unittest.TestCase):
 def test_root_override_rejected(self):
  with patch.dict(os.environ,{'BARBER_CLOUD_PROFILE_ROOT':'/workspace/another-project'}):
   with self.assertRaisesRegex(RuntimeError,'EXACT_OWNED_ROOT_REQUIRED'):p.base_root()
 def test_profile_allowlist(self):
  with self.assertRaisesRegex(RuntimeError,'PROFILE_ALLOWLIST'):p.checked_root('../../barber-cloud-compatibility')
 def test_symlink_ancestor_rejected(self):
  with tempfile.TemporaryDirectory()as d:
   a=Path(d);(a/'real').mkdir();(a/'link').symlink_to(a/'real',target_is_directory=True)
   with self.assertRaisesRegex(RuntimeError,'SYMLINK_ROOT_REJECTED'):p.safe_ancestors(a/'link/child')
 def test_exclusive_operation(self):
  with tempfile.TemporaryDirectory()as d,patch.object(p,'base_root',return_value=Path(d)):
   with p.operation_lock('test'):
    with self.assertRaises(BlockingIOError):
     with p.operation_lock('test'):pass
 def test_unknown_marker_refuses(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);(r/'profile.json').write_text(json.dumps({'profile':'test','synthetic_only':True,'source_sha':'foreign','ports':list(p.PROFILES['test']),'nonce':'a'*64}));(r/'profile.json').chmod(0o600);(r/'synthetic-secrets.json').write_text('{}');(r/'synthetic-secrets.json').chmod(0o600)
   (r/'native-stack/supabase').mkdir(parents=True)
   for f in ['config.toml','keys.json']:
    q=r/'native-stack/supabase'/f;q.write_text('{}');q.chmod(0o600)
   with patch.object(p,'checked_root',return_value=r):
    with self.assertRaisesRegex(RuntimeError,'PROFILE_GUARD'):p.context('test')
 def test_process_project_identity(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);s=r/'native-home/stacks/abc';s.mkdir(parents=True);(s/'state.json').write_text(json.dumps({'id':'abc','runtime':'native','identity':{'projectRoot':'/workspace/other','stackName':'barber-cloud-test'}}))
   with self.assertRaisesRegex(RuntimeError,'PROCESS_IDENTITY_MISMATCH'):p.verify_process_identity('test',r)
 def test_staging_dirty_rejected(self):
  import subprocess
  with patch.object(p.subprocess,'run',side_effect=[subprocess.CompletedProcess([],0,'a'*40),subprocess.CompletedProcess([],0,' M src/x')]):
   with self.assertRaisesRegex(RuntimeError,'DIRTY_STAGING_SOURCE'):p.source_commit(True)

 def test_reused_pid_start_identity_rejected(self):
  record={'startedAt':'2026-10-28T13:00:00Z'};r=Path('/workspace/owned-profile');exe=Path('/workspace/pinned-bin')
  observed={'uid':os.getuid(),'command':str(r).encode(),'exe':str(exe),'created':0}
  with self.assertRaisesRegex(RuntimeError,'OWNER_START_IDENTITY_MISMATCH'):p.validate_owner_identity(record,observed,r,exe)
 def test_wrong_owner_command_root_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'OWNER_COMMAND_MISMATCH'):p.validate_owner_identity({'startedAt':'2026-10-28T13:00:00Z'},{'uid':os.getuid(),'command':b'/workspace/foreign-profile','exe':'/workspace/pinned-bin','created':0},Path('/workspace/owned-profile'),Path('/workspace/pinned-bin'))
unittest.main()
