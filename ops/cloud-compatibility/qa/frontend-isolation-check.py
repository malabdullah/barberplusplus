import hashlib,json,os,subprocess,sys,urllib.request,importlib.util
from pathlib import Path
repo=Path(__file__).resolve().parents[3];runtime=repo/'ops/cloud-compatibility/runtime';state=Path('/workspace/barber-cloud-candidate-state');source=repo/'index.html';original=source.read_bytes();env=os.environ.copy();env['BARBER_NODE']=str(repo/'ops/cloud-compatibility/tooling/node/node_modules/.bin/node');env['BARBER_NATIVE_CLI']=str(repo/'ops/cloud-compatibility/tooling/native/node_modules/.bin/supabase');checks=[]
def check(name,ok):
 checks.append({'name':name,'status':'PASS'if ok else'FAIL'})
 if not ok:raise RuntimeError('ISOLATION_ASSERTION')
def command(tool,*args):
 p=subprocess.run([sys.executable,str(runtime/tool),*args],env=env,capture_output=True,text=True,timeout=180)
 if p.returncode:raise RuntimeError('OWNED_PROFILE_COMMAND_FAILED')
 return p.stdout

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def stage_files():return {str(p.relative_to(state/'staging')):digest(p)for directory in ['dist','source']for p in(state/'staging'/directory).rglob('*')if p.is_file()and 'node_modules'not in p.relative_to(state/'staging').parts}
def get_stage():
 with urllib.request.urlopen('http://127.0.0.1:56173/',timeout=5)as r:return r.read()
before=stage_files();config_before=digest(state/'staging/native-stack/supabase/config.toml');served_before=get_stage();baseline_before=json.loads(command('profile.py','baseline','staging'));test_before=digest(state/'test/dist/index.html')
try:
 source.write_bytes(original.replace(b'<title>Barber++ | Manager Dashboard</title>',b'<title>Barber++ | Synthetic Test edit</title>'))
 check('reversible Test source edit actually dirty',bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo).strip()))
 command('frontend.py','refresh','test');check('Test rebuilt its own HTML',digest(state/'test/dist/index.html')!=test_before)
 check('frozen Staging health works while Test source dirty',json.loads(command('profile.py','baseline','staging'))==baseline_before)
 command('frontend.py','stop','staging');command('frontend.py','start','staging');check('frozen Staging frontend stop/start permitted while Test dirty',get_stage()==served_before)
 command('profile.py','stop','staging');command('profile.py','start','staging');check('frozen Staging backend stop/start permitted while Test dirty',json.loads(command('profile.py','baseline','staging'))==baseline_before)
 check('Staging source and build hashes unchanged',stage_files()==before);check('Staging config unchanged',digest(state/'staging/native-stack/supabase/config.toml')==config_before)
finally:
 source.write_bytes(original);command('frontend.py','refresh','test');check('Test source restored byte-for-byte',source.read_bytes()==original)
 check('Test rebuild restored original HTML',digest(state/'test/dist/index.html')==test_before)
 check('candidate source checkout clean',not subprocess.check_output(['git','status','--porcelain'],cwd=repo).strip())
 result={'result':'PASS'if all(x['status']=='PASS'for x in checks)else'FAIL','staging_commit':json.loads((state/'staging/profile.json').read_text())['candidate_commit'],'checks':checks};(state/'frontend-isolation-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
