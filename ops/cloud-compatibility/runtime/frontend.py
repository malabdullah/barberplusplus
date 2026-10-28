"""Manage only a marker-owned profile's loopback frontend; no kill-by-port."""
import argparse,hashlib,json,os,signal,socket,subprocess,time
from pathlib import Path
import profile
HERE=Path(__file__).resolve().parent

def status(name,r):
 receipt=r/'frontend-process.json'
 if not receipt.exists():return None
 d=profile.private_json(receipt);proc=Path('/proc')/str(d['pid'])
 if not proc.exists():return None
 fields=(proc/'stat').read_text().rsplit(')',1)[1].split();ticks=fields[19]
 if proc.stat().st_uid!=os.getuid()or ticks!=d['start_ticks']:raise RuntimeError('FRONTEND_PROCESS_IDENTITY')
 if fields[0]=='Z':return None # Same exited process; never signal a reused PID.
 if str(r).encode()not in(proc/'cmdline').read_bytes():raise RuntimeError('FRONTEND_PROCESS_IDENTITY')
 return d

def build(name,r,e):
 repo=profile.source_repo(name);v=profile.private_json(r/'status-private.json')['env'];port=profile.PROFILES[name][2]
 (r/'empty-env').mkdir(exist_ok=True)
 e.update(VITE_APP_ENV='test',VITE_APP_URL=f'http://127.0.0.1:{port}',VITE_SUPABASE_URL=v['API_URL'],VITE_SUPABASE_PUBLISHABLE_KEY=v['PUBLISHABLE_KEY'],VITE_APP_RELEASE=profile.private_json(r/'profile.json')['candidate_commit'])
 node=Path(os.environ.get('BARBER_NODE',str(profile.BASE/'tooling/node/node_modules/.bin/node'))).resolve();e['PATH']=str(node.parent)+':'+e['PATH']
 if not(repo/'node_modules').is_dir():
  p=subprocess.run(['npm','ci','--no-audit','--no-fund'],cwd=repo,env=e,capture_output=True,text=True,timeout=180);profile.private_write(r/'results/frontend-npm.log',p.stdout+p.stderr)
  if p.returncode:raise RuntimeError('PROFILE_DEPENDENCIES_FAILED')
 config=r/'vite.frontend.config.mjs';config_text="import base from "+json.dumps(str(repo/'vite.config.js'))+";export default {...base,envDir:"+json.dumps(str(r/'empty-env'))+",build:{outDir:"+json.dumps(str(r/'dist'))+",emptyOutDir:true}};"
 profile.private_write(config,config_text)
 p=subprocess.run(['npm','run','build','--','--config',str(config)],cwd=repo,env=e,capture_output=True,text=True,timeout=120);profile.private_write(r/'results/build.log',p.stdout+p.stderr)
 if p.returncode:raise RuntimeError('PROFILE_BUILD_FAILED')
 runtime={'environment':'test','cloudProfile':name,'appUrl':f'http://127.0.0.1:{port}','supabaseUrl':v['API_URL'],'supabasePublishableKey':v['PUBLISHABLE_KEY'],'release':profile.private_json(r/'profile.json')['candidate_commit']}
 profile.private_write(r/'dist/runtime-config.js','window.__BARBER_CONFIG__ = '+json.dumps(runtime)+';')
 hashes={str(p.relative_to(r/'dist')):hashlib.sha256(p.read_bytes()).hexdigest()for p in(r/'dist').rglob('*')if p.is_file()}
 profile.private_write(r/'frontend-build.json',json.dumps({'candidate_commit':profile.private_json(r/'profile.json')['candidate_commit'],'files':hashes},sort_keys=True))

def stop(name,r):
 d=status(name,r)
 if not d:
  (r/'frontend-process.json').unlink(missing_ok=True);return
 os.kill(d['pid'],signal.SIGTERM)
 until=time.monotonic()+8
 while time.monotonic()<until:
  if status(name,r)is None:break
  proc=Path('/proc')/str(d['pid'])
  if(proc/'stat').exists()and(proc/'stat').read_text().rsplit(')',1)[1].split()[0]=='Z':break
  time.sleep(.1)
 else:raise RuntimeError('FRONTEND_STOP_TIMEOUT')
 (r/'frontend-process.json').unlink()

def start(name,r,e):
 if status(name,r):print('FRONTEND_ALREADY_RUNNING');return
 port=profile.PROFILES[name][2];sock=socket.socket();occupied=sock.connect_ex(('127.0.0.1',port))==0;sock.close()
 if occupied:raise RuntimeError('FRONTEND_PORT_OWNED_BY_OTHER_PROCESS')
 if not(r/'frontend-build.json').exists():build(name,r,e)
 d=profile.private_json(r/'frontend-build.json')
 if name=='staging'and d['candidate_commit']!=profile.private_json(r/'profile.json')['candidate_commit']:raise RuntimeError('FROZEN_BUILD_COMMIT_MISMATCH')
 for rel,digest in d['files'].items():
  if hashlib.sha256((r/'dist'/rel).read_bytes()).hexdigest()!=digest:raise RuntimeError('FROZEN_BUILD_HASH_MISMATCH')
 node=Path(os.environ.get('BARBER_NODE',str(profile.BASE/'tooling/node/node_modules/.bin/node'))).resolve();repo=profile.source_repo(name);log=(r/'results/frontend.log').open('a')
 p=subprocess.Popen([str(node),str(repo/'node_modules/vite/bin/vite.js'),'preview','--config',str(r/'vite.frontend.config.mjs'),'--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=repo,env=e,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 ticks=(Path('/proc')/str(p.pid)/'stat').read_text().rsplit(')',1)[1].split()[19]
 profile.private_write(r/'frontend-process.json',json.dumps({'pid':p.pid,'start_ticks':ticks,'profile':name,'port':port}))
 from urllib.request import urlopen
 until=time.monotonic()+10
 while time.monotonic()<until:
  if p.poll()is not None:raise RuntimeError('FRONTEND_EXITED')
  try:
   with urlopen(f'http://127.0.0.1:{port}/login',timeout=1)as response:
    if response.status==200:return
  except OSError:pass
  time.sleep(.1)
 raise RuntimeError('FRONTEND_READINESS_TIMEOUT')

def main():
 os.umask(0o077);a=argparse.ArgumentParser();a.add_argument('command',choices=['build','start','refresh','stop','status']);a.add_argument('profile',choices=profile.PROFILES);x=a.parse_args()
 with profile.operation_lock(x.profile):
  r,e,_=profile.context(x.profile)
  if x.command=='status':print(json.dumps({'running':status(x.profile,r)is not None}));return
  if x.command in ['stop','refresh']:stop(x.profile,r)
  if x.command in ['build','refresh']:build(x.profile,r,e)
  if x.command in ['start','refresh']:start(x.profile,r,e)
 print('FRONTEND_'+x.command.upper()+'_PASS '+x.profile)
if __name__=='__main__':
 try:main()
 except Exception:print('FRONTEND_FAILED SAFE_CATEGORY_LOCAL_ERROR');raise SystemExit(1)
