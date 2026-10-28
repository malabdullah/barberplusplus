import json,os
from pathlib import Path
base=Path('/workspace/barber-cloud-candidate-state')
for p in [base,*base.parents]:
 if p.is_symlink():raise SystemExit('SYMLINK_ROOT_REJECTED')
if base.exists() and any(base.iterdir()):raise SystemExit('ROOT_NOT_EMPTY')
base.mkdir(mode=0o700,exist_ok=True);base.chmod(0o700)
source=json.loads((Path(__file__).resolve().parents[1]/'candidate.json').read_text())['source_sha']
p=base/'.barber-cloud-owner.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w')as f:json.dump({'schema':1,'application':'barber-cloud-candidate','source_sha':source},f)
print('OWNED_ROOT_INITIALIZED')
