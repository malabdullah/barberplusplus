import os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import profile
name=os.environ.get('BARBER_CLOUD_PROFILE')
if name not in profile.PROFILES:raise SystemExit('PROFILE_ALLOWLIST')
if sys.argv[1:2]!=['-Atc']or len(sys.argv)!=3:raise SystemExit('READ_PROBE_SQL_ARGUMENTS_REQUIRED')
print(profile.db(name,sys.argv[2]))
