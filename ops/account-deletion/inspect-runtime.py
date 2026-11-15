#!/usr/bin/env python3
"""Read-only, bounded image/environment metadata; never print credential values."""
import argparse,json,pathlib,re,subprocess,sys

NAMES=('supabase-db','supabase-auth','supabase-storage','supabase-edge-functions')
SAFE_ENV=('APP_ENV','APP_URL','SUPABASE_URL','CUSTOMER_PUBLIC_API_URL','CUSTOMER_ACCOUNT_DELETION_BACKEND_URL','CUSTOMER_ACCOUNT_DELETION_ENABLED','CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED')
SECRET_NAMES=('SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','RESEND_API_KEY')

def summarize(records,lock):
    containers=[];functions=None
    for name in NAMES:
        record=next((x for x in records if x.get('Name','').lstrip('/')==name),None)
        if record is None:raise ValueError('Missing runtime')
        state=record.get('State',{});actual=record.get('Image','');expected=lock['containers'][name]['imageId']
        if not re.fullmatch(r'sha256:[0-9a-f]{64}',actual):raise ValueError('Invalid image identity')
        containers.append({'name':name,'imageId':actual,'expectedImageId':expected,'matchesLock':actual==expected,'running':state.get('Running')is True,'health':state.get('Health',{}).get('Status','not-reported')})
        if name=='supabase-edge-functions':
            env=dict(x.split('=',1)for x in record.get('Config',{}).get('Env',[])if '='in x)
            functions={'configuration':{key:env.get(key,'')for key in SAFE_ENV},'secretPresent':{key:bool(env.get(key))for key in SECRET_NAMES}}
    return{'schemaVersion':1,'readOnly':True,'containers':containers,'functions':functions,'exactImageMatches':all(x['matchesLock']for x in containers)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--lock',default=str(pathlib.Path(__file__).resolve().parents[1]/'release/runtime-lock.json'));args=parser.parse_args()
    lock=json.loads(pathlib.Path(args.lock).read_text())
    process=subprocess.run(['docker','inspect',*NAMES],capture_output=True,text=True,timeout=20)
    if process.returncode:raise RuntimeError('DockerUnavailable')
    result=summarize(json.loads(process.stdout),lock)
    print(json.dumps(result,sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception:
        # Docker errors, raw inspect output and environment values never escape.
        print(json.dumps({'status':'READINESS_UNAVAILABLE','readOnly':True}));sys.exit(1)
