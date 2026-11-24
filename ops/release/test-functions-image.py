#!/usr/bin/env python3
"""Compile all application workers on the pinned production Linux runtime.

Uses only synthetic settings. It has no database, production mounts or published
network port. Workers must start with internet access disabled.
"""
import argparse, hashlib, json, pathlib, shutil, subprocess, tempfile, time, uuid

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--source', default='.'); args = parser.parse_args()
    root = pathlib.Path(args.source).resolve()
    lock = json.loads((root / 'ops/release/runtime-lock.json').read_text())
    image = lock['containers']['supabase-edge-functions']['digest']
    names = sorted(p.name for p in (root / 'supabase/functions').iterdir() if p.is_dir() and not p.name.startswith('_') and (p / 'index.ts').exists())
    assert names and all(n.replace('-', '').isalnum() for n in names)
    name = 'barber-functions-compat-' + uuid.uuid4().hex[:10]
    created = False
    def run(command, timeout=180, check=True):
        p = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        if check and p.returncode: raise RuntimeError('Runtime command failed: ' + hashlib.sha256(p.stderr.encode()).hexdigest())
        return p.stdout
    with tempfile.TemporaryDirectory(prefix='barber-functions-compat-') as temporary:
        temp = pathlib.Path(temporary)
        source = temp / 'functions'
        shutil.copytree(root / 'supabase/functions', source, ignore=shutil.ignore_patterns('.env*', '*_test.ts', 'node_modules', '.cache'))
        subprocess.run(['node', 'ops/release/bundle-functions.mjs', str(root), str(source)], check=True)
        probe = temp / 'probe'; probe.mkdir()
        program = r'''
const names = new Set(NAMES);
Deno.serve(async (request) => {
  const url = new URL(request.url);
  const name = url.pathname.slice(1);
  if (!names.has(name)) return new Response('not found', {status:404});
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: '/functions/' + name,
      memoryLimitMb: 128, workerTimeoutMs: 60000, noModuleCache: false,
      envVars: [
        ['APP_ENV','development'], ['APP_URL','http://localhost:5173'],
        ['SUPABASE_URL','http://127.0.0.1:1'],
        ['SUPABASE_ANON_KEY','synthetic-unusable-key'],
        ['SUPABASE_SERVICE_ROLE_KEY','synthetic-unusable-service-role-key-over-thirty-two-characters'],
        ['CUSTOMER_BOOKING_TEST_API_URL','http://127.0.0.1:1'],
        ['CRON_SHARED_SECRET','synthetic-not-supplied']
      ]
    });
    // This production runtime requires its original native request, whose
    // transport resource cannot be reproduced with a constructed Request.
    const result = await worker.fetch(request);
    const closed = name === 'customer-account-deletion' ? await result.json() : null;
    return new Response(JSON.stringify({name,status:result.status,...(closed ? {closedError:closed.error} : {})}), {headers:{'Content-Type':'application/json'}});
  } catch (error) {
    console.error('Synthetic worker compatibility failure', name, error);
    const message = String(error).replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted]');
    return new Response(JSON.stringify({name,status:503,error:message.slice(0,1200)}), {status:503});
  }
});
'''.replace('NAMES', json.dumps(names))
        # The networkless container can still reach its own loopback.
        program += r'''
(async () => {
  try {
    const results = [];
    for (const name of names) {
      const response = await fetch('http://127.0.0.1:9000/' + name, {
        method: 'OPTIONS', headers: {Origin:'http://localhost:5173','Accept-Encoding':'identity'}
      });
      const result = await response.json();
      const expected = name === 'customer-account-deletion' ? [503]
        : name === 'cloud-test-inbox' ? [404]
        : name === 'customer-android-push-dispatch' ? [503]
        : ['customer-push-dispatch','customer-booking-email','admin-push-dispatch'].includes(name) ? [403]
        : [200,204,401,405];
      if (!response.ok || !expected.includes(result.status)
        || (name === 'customer-account-deletion' && result.closedError !== 'NOT_ENABLED'))
        throw new Error('Synthetic handler failed: ' + name + ': ' + JSON.stringify(result));
      results.push(result);
    }
    const behavior = await (await fetch('http://127.0.0.1:9000/get-kuwait-governorates?behavior=get', {headers:{'Accept-Encoding':'identity'}})).json();
    if (behavior.status !== 200) throw new Error('Read-only handler failed');
    console.log('BARBER_COMPAT_RESULT=' + JSON.stringify({status:'PASS',workers:results}));
  } catch (error) {
    console.log('BARBER_COMPAT_RESULT=' + JSON.stringify({status:'FAIL',error:String(error).slice(0,1600)}));
  }
})();
'''
        (probe / 'index.ts').write_text(program)
        try:
            run(['docker', 'run', '-d', '--name', name, '--platform', 'linux/amd64', '--network', 'none', '--memory', '768m', '--cpus', '1', '--mount', 'type=bind,src=' + str(source) + ',dst=/functions,readonly', '--mount', 'type=bind,src=' + str(probe) + ',dst=/probe,readonly', image, 'start', '--main-service', '/probe', '--port', '9000', '--max-parallelism', '2'])
            created = True
            actual = json.loads(run(['docker', 'inspect', name]))[0]
            if actual['NetworkSettings']['Ports'] and any(actual['NetworkSettings']['Ports'].values()): raise ValueError('Compatibility runtime must not publish ports')
            for _ in range(240):
                output = run(['docker', 'logs', name])
                matches = [line.split('BARBER_COMPAT_RESULT=',1)[1] for line in output.splitlines() if 'BARBER_COMPAT_RESULT=' in line]
                if matches:
                    result = json.loads(matches[-1])
                    if result['status'] != 'PASS': raise RuntimeError(result.get('error','Internal rehearsal failed'))
                    print(json.dumps({**result,'image':image,'platform':'linux/amd64','readOnlyHandlerExecution':'PASS','productionCredentials':False,'publishedPorts':0,'transport':'container-loopback'}))
                    return
                time.sleep(1)
            raise RuntimeError('Internal runtime rehearsal timed out')
        finally:
            if created: run(['docker', 'rm', '-f', name], check=False)

if __name__ == '__main__': main()
