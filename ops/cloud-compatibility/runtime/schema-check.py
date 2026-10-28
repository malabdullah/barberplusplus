import difflib,importlib.util,json,os,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse,unquote
import profile
name=sys.argv[1]
r,e,_=profile.context(name);v=json.loads((r/'status-private.json').read_text())['env'];u=urlparse(v['DB_URL'])
if u.hostname!='127.0.0.1'or u.port!=profile.PROFILES[name][1]:raise SystemExit('LOCAL_DATABASE_GUARD')
bin=next((r/'native-home/cache').rglob('bin/pg_dump')).parent
# Pinned CLI's db-dump template; same quote/schema/rewrite flags as the original
# proof. Strip dump comment chatter only; SQL COMMENT statements stay intact.
e.update(PGHOST=u.hostname,PGPORT=str(u.port),PGUSER=u.username,PGPASSWORD=unquote(u.password or ''),PGDATABASE=u.path.lstrip('/'),EXTRA_FLAGS='--schema public',EXTRA_SED='/^--/d',PATH=str(bin)+':'+e['PATH'])
p=subprocess.run(['bash',str(Path(__file__).with_name('dump-schema.sh'))],env=e,capture_output=True)
p.stdout=p.stdout.decode('utf-8')
if p.returncode:raise SystemExit('SCHEMA_DUMP_FAILED')
actual=r/'results/schema.actual.sql';actual.write_text(p.stdout)
spec=importlib.util.spec_from_file_location('normalizer',profile.REPO/'scripts/normalize-schema.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a=m.normalize((profile.REPO/'supabase/schema.expected.sql').open(newline='').read());b=m.normalize(p.stdout)
diff=''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='expected',tofile='actual'))
(r/'results/schema.diff').write_text(diff)
print('SCHEMA_EQUIVALENT_PASS'if not diff else'SCHEMA_DRIFT_FAIL');sys.exit(bool(diff))
