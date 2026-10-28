import json,tempfile,unittest,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent));import frontend
class FrontendProcessTests(unittest.TestCase):
 def run_case(self,state,ticks):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d)/'profile';r.mkdir();proc=Path(d)/'proc';p=proc/'123';p.mkdir(parents=True)
   receipt=r/'frontend-process.json';receipt.write_text(json.dumps({'pid':123,'start_ticks':'100'}));receipt.chmod(0o600)
   fields=[state]+['0']*18+[ticks];(p/'stat').write_text('123 (node) '+' '.join(fields));(p/'cmdline').write_bytes(str(r).encode())
   RealPath=Path
   with patch.object(frontend,'Path',side_effect=lambda x:proc if str(x)=='/proc'else RealPath(x)):
    return frontend.status('test',r)
 def test_exited_same_process(self):self.assertIsNone(self.run_case('Z','100'))
 def test_reused_pid_refused(self):
  with self.assertRaisesRegex(RuntimeError,'FRONTEND_PROCESS_IDENTITY'):self.run_case('Z','101')
 def test_live_same_process(self):self.assertEqual(self.run_case('S','100')['pid'],123)
unittest.main()
