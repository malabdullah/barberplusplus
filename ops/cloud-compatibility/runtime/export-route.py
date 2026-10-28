import json,sys
import profile
name=sys.argv[1];r,_,_=profile.context(name)
v=profile.private_json(r/'status-private.json')['env'];ports=profile.PROFILES[name]
from urllib.parse import urlparse
u=urlparse(v['API_URL'])
if u.hostname!='127.0.0.1'or u.port!=ports[0]:raise SystemExit('PROFILE_API_MISMATCH')
print(json.dumps({'profile':name,'apiPort':ports[0],'frontendPort':ports[2],'publishableKey':v['PUBLISHABLE_KEY']}))
