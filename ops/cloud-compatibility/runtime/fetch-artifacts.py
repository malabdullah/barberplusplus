"""Fetch only pinned official public native artifacts through inherited proxy/CA."""
from pathlib import Path
import json,hashlib,subprocess,concurrent.futures,os
import profile
root=profile.base_root()/'artifacts'
profile.safe_ancestors(root);root.mkdir(mode=0o700,exist_ok=True)
lock=json.loads((Path(__file__).with_name('native-services.lock.json')).read_text())
if not os.environ.get('HTTPS_PROXY'):raise SystemExit('INHERITED_HTTPS_PROXY_REQUIRED')
def fetch(name):
 p=lock['services'][name]['resolved'];pin=p['natives']['linux-amd64'];image=p['image'].split('@')[0];service=image.split('/')[-1].split(':')[0];version=image.split(':')[-1];tag=f'{service}-{version}';base=root/tag;base.mkdir(mode=0o700,exist_ok=True)
 for suffix,key in [('manifest.json','manifest'),('tar.zst','archive')]:
  filename=f'{tag}-linux-amd64.{suffix}';target=base/filename
  if target.is_symlink():raise RuntimeError('ARTIFACT_SYMLINK')
  if not target.exists():
   temporary=target.with_suffix(target.suffix+'.part')
   if temporary.exists():raise RuntimeError('PARTIAL_DOWNLOAD_REQUIRES_REVIEW')
   p=subprocess.run(['curl','--proto','=https','-fsSL','--max-time','180',f'https://github.com/supabase/slim-services/releases/download/{tag}/{filename}','-o',str(temporary)],capture_output=True)
   if p.returncode:temporary.unlink(missing_ok=True);raise RuntimeError(f'ARTIFACT_FETCH_FAILED {name} curl_exit_{p.returncode}')
   if hashlib.file_digest(temporary.open('rb'),'sha256').hexdigest()!=pin[key]:raise RuntimeError('ARTIFACT_HASH_MISMATCH')
   temporary.rename(target)
  if hashlib.file_digest(target.open('rb'),'sha256').hexdigest()!=pin[key]:raise RuntimeError('ARTIFACT_HASH_MISMATCH')
 return {'service':name,'version':version,'manifest_archive_sha256':'PASS','source':'official GitHub release; inherited proxy/CA; TLS verification ON'}
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:results=list(pool.map(fetch,['database','auth','rest','realtime','storage','functions','mail','imgproxy']))
profile.private_write(root/'download-receipt.json',json.dumps(results,indent=2));print(json.dumps(results))
