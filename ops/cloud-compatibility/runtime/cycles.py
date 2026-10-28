"""Bounded clean synthetic profile cycles; archived data/evidence is retained."""
import argparse,json,os,subprocess,sys,time
from pathlib import Path
import profile
HERE=Path(__file__).resolve().parent

def command(args,env,log):
 started=time.monotonic();p=subprocess.run(args,cwd=profile.REPO,env=env,capture_output=True,text=True,timeout=240)
 with log.open('a')as f:f.write(p.stdout+p.stderr)
 if p.returncode:raise RuntimeError('CYCLE_COMMAND_FAILED '+Path(args[0]).name)
 return round(time.monotonic()-started,3)
def main():
 os.umask(0o077);a=argparse.ArgumentParser();a.add_argument('profile',choices=profile.PROFILES);a.add_argument('--cycles',type=int,default=2);x=a.parse_args()
 if x.cycles not in [1,2]:raise RuntimeError('BOUNDED_CYCLES_REQUIRED')
 env=os.environ.copy();env['BARBER_CLOUD_PROFILE']=x.profile;env['BARBER_CLOUD_STATE']=str(profile.checked_root(x.profile));node=env.get('BARBER_NODE',str(profile.BASE/'tooling/node/node_modules/.bin/node'));reports=[]
 for cycle in range(1,x.cycles+1):
  stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime());log=profile.base_root()/f'{x.profile}-cycle-{stamp}-{cycle}.log';durations=[]
  existed=profile.checked_root(x.profile).exists()
  phases=[['reset'if existed else'init',x.profile],['start',x.profile,'--db-only'],['disable-cron',x.profile],['stop',x.profile],['start',x.profile],['replay',x.profile],['pgtap',x.profile]]
  for args in phases:durations.append(command([sys.executable,str(HERE/'profile.py'),*args],env,log))
  for tool in ['schema-check.py','backend-check.mjs','edge-check.mjs','realtime-probe.mjs']:
   durations.append(command([sys.executable if tool.endswith('.py')else node,str(HERE/tool),x.profile],env,log))
  for action in ['build','start']:durations.append(command([sys.executable,str(HERE/'frontend.py'),action,x.profile],env,log))
  baseline=profile.baseline(x.profile)
  if baseline!={'users':5,'bookings':1,'cron':'off'}:raise RuntimeError('CYCLE_BASELINE_FAILED')
  report={'profile':x.profile,'cycle':cycle,'result':'PASS','source_commit':profile.private_json(profile.checked_root(x.profile)/'profile.json')['candidate_commit'],'baseline':baseline,'seconds':round(sum(durations),3),'cached_native_binary_copy':bool(env.get('BARBER_SHARED_NATIVE_CACHE')),'log':str(log)};reports.append(report);print(json.dumps(report),flush=True)
  profile.private_write(profile.base_root()/f'{x.profile}-cycles.json',json.dumps(reports,indent=2))
if __name__=='__main__':
 try:main()
 except Exception as e:print('CYCLES_FAILED safe category '+str(e));sys.exit(1)
