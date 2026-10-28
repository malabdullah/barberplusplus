import hashlib,json,os,subprocess
from pathlib import Path
base=Path(__file__).resolve().parents[1];m=json.loads((base/'tool-versions.json').read_text())
files={'node':Path(os.environ.get('BARBER_NODE',str(base/'tooling/node/node_modules/.bin/node'))),'native_cli':Path(os.environ.get('BARBER_NATIVE_CLI',str(base/'tooling/native/node_modules/.bin/supabase'))),'deno':base.parents[1]/'node_modules/.bin/deno'}
files['native_host']=files['native_cli'].resolve().parents[2]/'@supabase/cli-linux-x64/bin/supabase'
for name,p in files.items():
 if not p.is_file()or hashlib.sha256(p.read_bytes()).hexdigest()!=m['installed_binary_sha256'][name]:raise SystemExit('PINNED_TOOL_HASH_FAILED '+name)
 print('PINNED_TOOL_HASH_PASS '+name)
