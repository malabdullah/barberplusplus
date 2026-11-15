#!/usr/bin/env python3
"""PROPOSED read-only diagnostic. Execution requires separate reviewed approval."""
import contextlib
import fcntl
import json
import os
import pathlib
import re
import stat
import subprocess
import sys

OVERRIDE = '/etc/barber-release/prepared-backend-runtime.override.json'
LOCK = '/var/lib/barber-release-backend/backend.lock'
CONTAINER = 'supabase-edge-functions'
IMAGE = 'sha256:2781daf92394db91f7e94129cc3d04ec474ad16a8fe64b3fbeef6e7d557ab120'
PINS = {'APP_ENV': 'production', 'APP_URL': 'https://www.barberplusplus.com',
        'SUPABASE_URL': 'http://api-gw:8000', 'CUSTOMER_PUBLIC_API_URL': 'https://srv1073968.hstgr.cloud'}
BACKEND = 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL'
FLAGS = ('CUSTOMER_ACCOUNT_DELETION_ENABLED', 'CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED', 'CUSTOMER_APPLE_REVOCATION_ENABLED')
PRESENCE = ('CUSTOMER_APPLE_REVOCATION_CLIENTS', 'CUSTOMER_APPLE_ENCRYPTION_KEY')
EXPECTED = {**PINS, BACKEND: 'http://api-gw:8000', **dict.fromkeys(FLAGS, 'false')}
LIMIT = 1024 * 1024


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@contextlib.contextmanager
def private_file(path, *, empty=False, uid=0):
    # Tests inject disposable paths/UIDs; the CLI accepts no path arguments.
    path = pathlib.Path(path)
    parent = path.parent.lstat()
    if (path.parent.resolve() != path.parent or not stat.S_ISDIR(parent.st_mode)
            or parent.st_uid != uid or stat.S_IMODE(parent.st_mode) != 0o700):
        raise ValueError('PRIVATE_PARENT')
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fd = None
    try:
        if fingerprint(parent) != fingerprint(os.fstat(directory)):
            raise ValueError('PARENT_DRIFT')
        before = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != uid or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > LIMIT
                or (empty and before.st_size != 0)):
            raise ValueError('PRIVATE_FILE')
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        def stable():
            if (fingerprint(before) != fingerprint(os.fstat(fd))
                    or fingerprint(before) != fingerprint(os.stat(path.name, dir_fd=directory, follow_symlinks=False))
                    or fingerprint(parent) != fingerprint(path.parent.lstat())):
                raise ValueError('FILE_DRIFT')
        stable()
        yield fd, stable
        stable()
    finally:
        if fd is not None:
            os.close(fd)
        os.close(directory)


def explicit(document):
    try:
        env = document['services']['functions']['environment']
    except (KeyError, TypeError):
        raise ValueError('OVERRIDE_ENVIRONMENT_STRUCTURE') from None
    if not isinstance(env, dict):
        raise ValueError('OVERRIDE_ENVIRONMENT_STRUCTURE')
    result = {k: {'present': k in env, 'matchesExpected': env.get(k) == value,
                  'containsInterpolation': isinstance(env.get(k), str) and '${' in env[k]}
              for k, value in EXPECTED.items()}
    result.update({k: {'present': k in env} for k in PRESENCE})
    result['compoundPredicate'] = {
        'fourExplicitPinsMatch': all(env.get(k) == v for k, v in PINS.items()),
        'pairAndEncryptionAbsent': all(k not in env for k in PRESENCE),
        'flagsAbsentOrFalse': all(env.get(k, 'false') == 'false' for k in FLAGS),
        'optionalBackendAbsentOrExpected': env.get(BACKEND, 'http://api-gw:8000') == EXPECTED[BACKEND]}
    return result


def projection():
    # Docker emits only MATCH/OTHER markers or presence; never environment values.
    fields = []
    for key in (*EXPECTED, *PRESENCE):
        marker = 'true' if key in PRESENCE else ('{{if eq . ' + json.dumps(key + '=' + EXPECTED[key]) + '}}"MATCH"{{else}}"OTHER"{{end}}')
        fields.append(json.dumps(key) + ':[{{range .Config.Env}}{{if eq (index (split . "=") 0) '
                      + json.dumps(key) + '}}' + marker + ',{{end}}{{end}}null]')
    return ('{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"image":{{json .Image}},'
            '"running":{{json .State.Running}},"healthy":{{if .State.Health}}{{eq .State.Health.Status "healthy"}}{{else}}false{{end}},'
            '"configHash":{{json (index .Config.Labels "com.docker.compose.config-hash")}},"fields":{' + ','.join(fields) + '}}')


def effective(snapshot):
    fields = snapshot['fields']
    if set(fields) != set(EXPECTED) | set(PRESENCE):
        raise ValueError('RUNTIME_FIELDS')
    result = {}
    for key, values in fields.items():
        allowed = (True,) if key in PRESENCE else ('MATCH', 'OTHER')
        if (not isinstance(values, list) or not values or values[-1] is not None
                or len(values) > 2 or any(type(v) != type(allowed[0]) or v not in allowed for v in values[:-1])):
            raise ValueError('DUPLICATE_OR_INVALID_RUNTIME_FIELD')
        result[key] = {'present': len(values) == 2}
        if key in EXPECTED:
            result[key]['matchesExpected'] = values == ['MATCH', None]
    return result


def run(arguments):
    result = subprocess.run(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=20, check=False)
    if result.returncode or len(result.stdout) > LIMIT:
        raise ValueError('READ_ONLY_COMMAND_FAILED')
    return result.stdout


def collect(document, runner=run):
    command = ['docker', 'inspect', '--type', 'container', '--format', projection(), CONTAINER]
    before = json.loads(runner(command))
    runtime = effective(before)
    model = runner(['docker', 'compose', '--project-directory', '/root/supabase/docker',
                    '--env-file', '/root/supabase/docker/.env', '-f', '/root/supabase/docker/docker-compose.yml',
                    '-f', OVERRIDE, 'config', '--hash', 'functions']).decode().strip().split()
    if len(model) != 2 or model[0] != 'functions' or not re.fullmatch('[a-f0-9]{64}', model[1]):
        raise ValueError('COMPOSE_HASH_FORMAT')
    after = json.loads(runner(command))
    if before != after:
        raise ValueError('RUNTIME_DRIFT_DURING_DIAGNOSTIC')
    return {'status': 'READ_ONLY_DIAGNOSTIC_REVIEW_REQUIRED', 'explicitOverride': explicit(document),
            'effectiveRuntime': runtime, 'functionsMetadata': {
                'matchesReviewedImage': before.get('image') == IMAGE, 'running': before.get('running') is True,
                'healthy': before.get('healthy') is True,
                'composeHashMatchesRuntime': before.get('configHash') == model[1]},
            'interpretationRequiresReview': True, 'mutationsAttempted': False}


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0 or os.uname().nodename.split('.')[0] != 'srv1073968':
        raise ValueError('FIXED_ROOT_DB_STDIN_ONLY')
    with private_file(LOCK, empty=True) as (lock, lock_stable):
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        lock_stable()
        with private_file(OVERRIDE) as (source, source_stable):
            raw = os.read(source, LIMIT + 1)
            if len(raw) > LIMIT:
                raise ValueError('OVERRIDE_SIZE')
            document = json.loads(raw)
            source_stable()
            result = collect(document)
            source_stable()
            lock_stable()
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never serialize exception text, subprocess errors, source or raw Docker output.
        print(json.dumps({'status': 'STOP_READ_ONLY_DIAGNOSTIC_UNAVAILABLE', 'mutationsAttempted': False}))
        raise SystemExit(2)
