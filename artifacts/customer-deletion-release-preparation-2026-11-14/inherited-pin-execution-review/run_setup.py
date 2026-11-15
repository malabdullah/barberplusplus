#!/usr/bin/env python3
"""Fixed approved call-plan implementation; root DB stdin only, safe JSON output."""
import copy
import fcntl
import hashlib
import importlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import sys
import time

CACHE = pathlib.Path('/etc/barber-release/apple-cleanup-setup-public-inherited-pin-v1')
ROOT = pathlib.Path('/etc/barber-release/apple-cleanup-renewal')
ACTIVE = pathlib.Path('/etc/barber-release/prepared-backend-runtime.override.json')
LOCK = pathlib.Path('/var/lib/barber-release-backend/backend.lock')
RECOVERY = pathlib.Path('/etc/barber-release/recovery/customer-apple-encryption-v1')
INSTALLED = pathlib.Path('/usr/local/lib/barber-release')
UNITS = pathlib.Path('/etc/systemd/system')
LOGIN = pathlib.Path('/etc/barber-release/apple-renewal/config.json')
TIMERS = ('barber-apple-cleanup-renewal.timer', 'barber-apple-cleanup-monitor.timer')
EXISTING = ('barber-apple-renewal.timer', 'barber-backup-daily.timer')
HASHES = {'apple_renewal.py': '810d3cb8fc618b70c8bb4a8e05c3306753ea4dba9d5515cf0ec20aa19b08ee23', 'apple_cleanup_renewal.py': '7bd0458b3989c3b394e302d78e2b2e29619abb0d86cbc37a70903b1e0c5b97e6', 'apple_cleanup_bootstrap.py': '9584809bac8309f2b8f1045299864fbfdb5a6921cecd6af98d254c0fd5c9c576', 'apple_cleanup_recovery.py': 'cf25b0a2b9f817bcb60c77a6c79e4930cd3be3597c3a44654c93245903b252d4', 'apple-cleanup-renewal.config.example.json': 'a369e434284d1d583999d1f0a8dfc7f8ef675869a425b6fe4a9828e3ee5e39b9', 'barber-apple-cleanup-renewal.service': '1fb39118f983bd1a8ebe36edd17882be8d134ea8ad68ac91bbf3414833ae99a2', 'barber-apple-cleanup-renewal.timer': 'd7ed645a4757b95b06aa4db77b0692d12d4bcc191ba260048c9f7fb6c168db3d', 'barber-apple-cleanup-monitor.service': 'cd0376e978b173c4e5ee67f2ff32284a9ce0a38836f22d3ef740db3631532cba', 'barber-apple-cleanup-monitor.timer': 'eebad465b2fd90662b1f6c16337305762ff1d8d30e1a0b806131ad21a800ecbc', 'apple_cleanup_inherited_pin.py': 'e9f15dd2fc26994043e70a462d9fdbaf08e96cecc762f2b7cc345c459b3fcc0d'}
INSTALL = {'apple_cleanup_renewal.py': {'destination': '/usr/local/lib/barber-release/apple_cleanup_renewal.py', 'mode': '0755'}, 'apple_cleanup_bootstrap.py': {'destination': '/usr/local/lib/barber-release/apple_cleanup_bootstrap.py', 'mode': '0755'}, 'apple_cleanup_recovery.py': {'destination': '/usr/local/lib/barber-release/apple_cleanup_recovery.py', 'mode': '0755'}, 'apple-cleanup-renewal.config.example.json': {'destination': '/etc/barber-release/apple-cleanup-renewal/config.json', 'mode': '0600'}, 'barber-apple-cleanup-renewal.service': {'destination': '/etc/systemd/system/barber-apple-cleanup-renewal.service', 'mode': '0644'}, 'barber-apple-cleanup-renewal.timer': {'destination': '/etc/systemd/system/barber-apple-cleanup-renewal.timer', 'mode': '0644'}, 'barber-apple-cleanup-monitor.service': {'destination': '/etc/systemd/system/barber-apple-cleanup-monitor.service', 'mode': '0644'}, 'barber-apple-cleanup-monitor.timer': {'destination': '/etc/systemd/system/barber-apple-cleanup-monitor.timer', 'mode': '0644'}}
PHASE = 'NOT_STARTED'
DEADLINES = None
SAFE = {'privateKeyRead': False, 'credentialsGenerated': False, 'runtimeChanged': False,
        'credentialIssuanceCalls': 0, 'credentialIssuanceCompleted': 0, 'entropyCalls': 0, 'entropyCompleted': 0,
        'configurationReplaced': False,
        'newTimersEnabled': False, 'providerCalls': False, 'secretsExported': False}


class GuardStop(ValueError):
    def __init__(self, code):
        self.code = code if isinstance(code, str) and re.fullmatch('[A-Z0-9_]{1,80}', code) else 'UNCLASSIFIED_GUARD'
        super().__init__(self.code)


def require(condition, code):
    if not condition:
        raise GuardStop(code)


def phase(name):
    global PHASE
    PHASE = name
    print(json.dumps({'phase': name, 'atUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}), flush=True)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def stable_runtime(values):
    return [(item['Name'], item['Id'], item['Image'], item['State']['StartedAt'],
             item['State']['Running'], item['State'].get('Health', {}).get('Status'),
             item['Config']['Env'], item['Config'].get('Labels', {}).get('com.docker.compose.config-hash'))
            for item in values]


def replacement_state(observed, original, candidate):
    require(observed in (original, candidate), 'UNKNOWN_ATOMIC_REPLACEMENT_STATE')
    return 'CANDIDATE' if observed == candidate else 'ORIGINAL'


def tracked_generation(issue_function, entropy_function, safe):
    def issue(scoped_config, now):
        safe['credentialIssuanceCalls'] += 1
        token = issue_function(scoped_config, now)
        safe['credentialIssuanceCompleted'] += 1
        safe['credentialsGenerated'] = True
        return token
    def entropy(size):
        safe['entropyCalls'] += 1
        value = entropy_function(size)
        safe['entropyCompleted'] += 1
        return value
    return issue, entropy


def access_deadlines(environment, now):
    names = ('BARBER_SETUP_ACTIVATED_UTC', 'BARBER_SETUP_STOP_UTC', 'BARBER_SETUP_HARD_UTC')
    require(all(re.fullmatch(r'[0-9]{10}', environment.get(name, '')) for name in names), 'ACCESS_DEADLINE_PARAMETERS')
    activation, stop, hard = (int(environment[name]) for name in names)
    require(stop == activation + 2700 and hard == activation + 3600 and activation <= now < stop, 'ACCESS_WINDOW_BINDING')
    return activation, stop, hard


def secure(path, *, private=True, limit=2 * 1024 * 1024):
    path = pathlib.Path(path)
    require(path.resolve() == path, 'CANONICAL_FILE')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and not (info.st_mode & (0o077 if private else 0o022)) and info.st_size <= limit, 'SECURE_FILE')
        raw = os.read(fd, limit + 1)
        require(len(raw) <= limit and fingerprint(info) == fingerprint(os.fstat(fd))
                and fingerprint(path.lstat()) == fingerprint(info), 'SOURCE_READ_DRIFT')
        return raw
    finally:
        os.close(fd)


def directory(path, *, private=True):
    path = pathlib.Path(path); info = path.lstat()
    require(path.resolve() == path and stat.S_ISDIR(info.st_mode) and info.st_uid == 0
            and not (info.st_mode & (0o077 if private else 0o022)), 'SECURE_DIRECTORY')


def missing(path):
    require(not pathlib.Path(path).exists() and not pathlib.Path(path).is_symlink(), 'PREEXISTING_PATH')


def exclusive(path, raw, mode):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as handle:
        os.fchmod(handle.fileno(), mode); handle.write(raw); handle.flush(); os.fsync(handle.fileno())


def command(args, data=None, *, recovery=False):
    require(DEADLINES is not None, 'ACCESS_WINDOW_UNBOUND')
    remaining = DEADLINES[2 if recovery else 1] - time.time()
    require(remaining > 0, 'HARD_WINDOW_EXPIRED' if recovery else 'WORK_WINDOW_EXPIRED')
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=min(90, remaining))
    require(result.returncode == 0, 'COMMAND_FAILED')
    return result.stdout


def timer_state(names, *, recovery=False):
    result = {}
    for name in names:
        raw = command(['systemctl', 'show', name, '--no-pager', '--property=LoadState,ActiveState,SubState,UnitFileState'], recovery=recovery)
        values = dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)
        require(set(values) == {'LoadState', 'ActiveState', 'SubState', 'UnitFileState'}, 'UNIT_STATE')
        result[name] = values
    return result


def model_hash(host):
    values = command(host.compose(ACTIVE) + ['config', '--hash', 'functions']).decode().split()
    require(len(values) == 2 and values[0] == 'functions' and re.fullmatch('[a-f0-9]{64}', values[1]), 'MODEL_HASH')
    return values[1]


def install_public():
    for name, item in INSTALL.items():
        destination = pathlib.Path(item['destination'])
        # Config is installed separately with the validated exact fixed document.
        if name.endswith('.example.json'):
            continue
        exclusive(destination, secure(CACHE / name), int(item['mode'], 8))


def setup():
    global DEADLINES
    require(len(sys.argv) == 1 and os.geteuid() == 0 and os.uname().nodename.split('.')[0] == 'srv1073968', 'FIXED_ROOT_DB_ONLY')
    DEADLINES = access_deadlines(os.environ, time.time())
    os.umask(0o077)
    phase('PUBLIC_SOURCE_GUARDS')
    directory(CACHE)
    require(set(x.name for x in CACHE.iterdir()) == set(HASHES), 'EXACT_PUBLIC_CACHE')
    for name, expected in HASHES.items(): require(sha(secure(CACHE / name)) == expected, 'PUBLIC_SOURCE_HASH')
    require(sha(secure(INSTALLED / 'apple_renewal.py', private=False)) == HASHES['apple_renewal.py'], 'ORIGINAL_SIGNING_HELPER_HASH')
    sys.path.insert(0, str(CACHE))
    signing = importlib.import_module('apple_renewal')
    renewal = importlib.import_module('apple_cleanup_renewal')
    bootstrap = importlib.import_module('apple_cleanup_bootstrap')
    inherited = importlib.import_module('apple_cleanup_inherited_pin')
    signing.command = command
    config = json.loads(secure(CACHE / 'apple-cleanup-renewal.config.example.json'))
    renewal.validate_config(config, installed=True)
    require(config['keyId'] == 'G2ANJ69763', 'FIXED_KEY_METADATA')
    directory(ACTIVE.parent); directory(INSTALLED, private=False); directory(UNITS, private=False)
    directory(LOCK.parent)
    missing(ROOT); missing(RECOVERY)
    for item in INSTALL.values(): missing(item['destination'])
    for name in TIMERS: missing(UNITS / 'timers.target.wants' / name)
    if RECOVERY.parent.exists(): directory(RECOVERY.parent)
    lock = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    enabled = False; active_written = False; replacement_attempted = False
    original = None; candidate = None; baseline = None
    host = renewal.Host(config)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 1 and info.st_size == 0 and LOCK.lstat() == info, 'SECURE_EXISTING_LOCK')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        phase('LOCKED_FRESH_SOURCE_RUNTIME_MODEL')
        original = secure(ACTIVE)
        login_raw = secure(LOGIN); login = json.loads(login_raw)
        expected_login = {'environment': 'production', 'teamId': config['teamId'], 'keyId': config['keyId'],
                          'clientId': renewal.CLIENTS['web'], 'keyFile': config['keyFile'], 'overrideFile': str(ACTIVE),
                          'composeDirectory': config['composeDirectory'], 'composeFile': config['composeFile'],
                          'backendLockFile': str(LOCK), 'stateDirectory': '/etc/barber-release/apple-renewal/state',
                          'authImageId': config['imageIds']['supabase-auth']}
        require(all(login.get(k) == v for k, v in expected_login.items()), 'CANONICAL_LOGIN_METADATA')
        require(signing.expected_client_ids(login) == [renewal.CLIENTS['web'], renewal.CLIENTS['ios']], 'EXACT_LOGIN_CLIENTS')
        directory(LOGIN.parent)
        source = json.loads(original); before = host.inspect(); env = renewal.runtime_env(before[0])
        actual_hash = model_hash(host)
        proof = {'sourceSha256': sha(original), 'runtimeBindings': {k: env.get(k) for k in inherited.PINS},
                 'runtimeAbsentFields': sorted(k for k in inherited.ABSENT if k not in env),
                 'functionsImageId': before[0]['Image'], 'functionsRunning': before[0]['State']['Running'],
                 'functionsHealthy': before[0]['State'].get('Health', {}).get('Status') == 'healthy',
                 'composeModelHash': actual_hash, 'runtimeComposeHash': before[0]['Config']['Labels'].get('com.docker.compose.config-hash')}
        inherited.candidate_base(config, original, proof)
        auth_env = renewal.runtime_env(before[1])
        login_token = source['services']['auth']['environment'][signing.SECRET]
        require(auth_env.get(signing.SECRET) == login_token and auth_env.get('GOTRUE_EXTERNAL_APPLE_ENABLED') == 'true'
                and auth_env.get('GOTRUE_EXTERNAL_APPLE_CLIENT_ID') == ','.join(signing.expected_client_ids(login)), 'LOGIN_RUNTIME_SOURCE')
        old_timers = timer_state(EXISTING)
        require(all(v['ActiveState'] == 'active' and v['UnitFileState'] == 'enabled' for v in old_timers.values()), 'EXISTING_TIMERS')
        # Fixed key metadata/permissions are checked without reading P8 bytes here.
        key_info = pathlib.Path(config['keyFile']).lstat()
        require(pathlib.Path(config['keyFile']).resolve() == pathlib.Path(config['keyFile']) and stat.S_ISREG(key_info.st_mode)
                and key_info.st_uid == 0 and not key_info.st_mode & 0o077, 'EXISTING_KEY_REFERENCE')
        require(secure(ACTIVE) == original and stable_runtime(host.inspect()) == stable_runtime(before), 'LOCKED_PREFLIGHT_DRIFT')
        phase('VERIFY_EXISTING_WEB_CREDENTIAL')
        SAFE['privateKeyRead'] = True
        claims = signing.validate(login_token, login, int(time.time()))
        require(claims['exp'] > int(time.time()), 'LOGIN_CREDENTIAL_EXPIRED')
        phase('STAGE_FINAL_DEFAULT_OFF_CANDIDATE')
        ROOT.mkdir(mode=0o700); (ROOT / 'state').mkdir(mode=0o700)
        exclusive(ROOT / 'config.json', json.dumps(config, indent=2).encode(), 0o600)
        issue, entropy = tracked_generation(signing.issue, secrets.token_hex, SAFE)
        report = inherited.stage(config, original, int(time.time()), proof, issue=issue, validate=signing.validate, entropy=entropy)
        require(SAFE['credentialIssuanceCalls'] == 2 and SAFE['entropyCalls'] == 1, 'EXACT_INITIAL_GENERATION_COUNTS')
        stage = ROOT / 'bootstrap'; candidate = secure(stage / 'staged.override.json')
        require(secure(stage / 'original.override.json') == original, 'ACTUAL_ORIGINAL_BYTES')
        changed = json.loads(candidate); additions = {inherited.PIN, *inherited.ABSENT}
        restored = copy.deepcopy(changed)
        for key in additions: restored['services']['functions']['environment'].pop(key, None)
        require(restored == source and all(key not in source['services']['functions']['environment'] for key in additions), 'EXACT_SEVEN_NEW_FIELDS')
        target = renewal.function_env(changed)
        require(all(target.get(flag) == 'false' for flag in bootstrap.FLAGS), 'DEFAULT_OFF_FLAGS')
        expected_env = {**env, **{k: target[k] for k in inherited.ABSENT}}
        baseline = {'functionsImageId': before[0]['Image'],
                    'otherEnvironmentSha256': sha(json.dumps({k: v for k, v in expected_env.items() if k != renewal.PAIR}, sort_keys=True).encode()),
                    'untouchedContainers': [{'id': item['Id'], 'startedAt': item['State']['StartedAt']} for item in before[1:]]}
        phase('INSTALL_NEW_FILES_VALIDATE_CANDIDATE_UNITS')
        require(secure(ACTIVE) == original and secure(LOGIN) == login_raw, 'SOURCE_BEFORE_INSTALL')
        install_public()
        if not RECOVERY.parent.exists(): RECOVERY.parent.mkdir(mode=0o700)
        directory(RECOVERY.parent); exclusive(RECOVERY, target[renewal.ENCRYPTION].encode(), 0o600)
        host.validate_candidate(stage / 'staged.override.json')
        command(['systemd-analyze', 'verify', *[str(UNITS / name) for name in INSTALL if name.startswith('barber-')]])
        require(secure(ACTIVE) == original and stable_runtime(host.inspect()) == stable_runtime(before)
                and model_hash(host) == actual_hash, 'BEFORE_SINGLE_ACTIVE_REPLACEMENT')
        phase('ONE_FUNCTIONS_DEFAULT_OFF_RECREATE')
        replacement_attempted = True
        signing.atomic(ACTIVE, candidate); active_written = True
        SAFE['configurationReplaced'] = True; SAFE['runtimeChanged'] = True
        host.activate(ACTIVE); host.verify(target[renewal.PAIR], baseline)
        after = host.inspect()
        require(renewal.runtime_env(after[0]) == expected_env, 'EXACT_FUNCTIONS_ENVIRONMENT')
        require(all(renewal.runtime_env(left) == renewal.runtime_env(right) for left, right in zip(before[1:], after[1:])), 'UNTOUCHED_OTHER_ENVIRONMENTS')
        require(secure(LOGIN) == login_raw and sha(secure(INSTALLED / 'apple_renewal.py', private=False)) == HASHES['apple_renewal.py'], 'LOGIN_PRESERVED')
        require(model_hash(host) == after[0]['Config']['Labels'].get('com.docker.compose.config-hash'), 'FINAL_COMPOSE_MODEL')
        # Companion acquires the same lock; never invoke it while holding ours.
        fcntl.flock(lock, fcntl.LOCK_UN)
        phase('INSTALLED_CHECK_AND_FRESH_NOOP')
        check = json.loads(command(['/usr/bin/python3', '-B', str(INSTALLED / 'apple_cleanup_renewal.py'), '--check']))
        normal = json.loads(command(['/usr/bin/python3', '-B', str(INSTALLED / 'apple_cleanup_renewal.py')]))
        require(check.get('status') == 'CHECKED' and normal.get('status') == 'HEALTHY_NOT_DUE'
                and check.get('severity') == normal.get('severity') == 'OK' and not check.get('due') and not normal.get('due'), 'FRESH_NOOP_CHECKS')
        phase('ENABLE_TWO_PERSISTENT_TIMERS')
        command(['systemctl', 'daemon-reload'])
        enabled = True  # Includes partial enable failures in recognized rollback.
        command(['systemctl', 'enable', '--now', *TIMERS]); SAFE['newTimersEnabled'] = True
        new_timers = timer_state(TIMERS)
        require(all(v['ActiveState'] == 'active' and v['UnitFileState'] == 'enabled' for v in new_timers.values()), 'NEW_TIMERS_ACTIVE_ENABLED')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        phase('FINAL_PRESERVATION_AND_PRIVATE_RECOVERY_RECEIPT')
        final = host.inspect()
        require(stable_runtime(final) == stable_runtime(after), 'NOOP_TIMERS_DID_NOT_RECREATE')
        require(secure(ACTIVE) == candidate and renewal.runtime_env(final[0]) == expected_env, 'FINAL_SOURCE_RUNTIME')
        require([{'id': x['Id'], 'startedAt': x['State']['StartedAt']} for x in final[1:]] == baseline['untouchedContainers'], 'FINAL_OTHER_SERVICE_IDENTITIES')
        require(all(renewal.runtime_env(a) == renewal.runtime_env(b) for a, b in zip(before[1:], final[1:])), 'FINAL_OTHER_ENVIRONMENTS')
        require(secure(LOGIN) == login_raw and timer_state(EXISTING) == old_timers, 'FINAL_LOGIN_EXISTING_TIMERS')
        require(secure(RECOVERY) == target[renewal.ENCRYPTION].encode(), 'SAME_RECOVERY_KEY')
        for name, item in INSTALL.items():
            installed_raw = secure(item['destination'], private=name.endswith('.example.json'), limit=2 * 1024 * 1024)
            require((json.loads(installed_raw) == config) if name.endswith('.example.json') else sha(installed_raw) == HASHES[name], 'INSTALLED_SOURCE')
        installed_at = int(time.time())
        recovery_record = {'status': 'INSTALLED_DEFAULT_OFF_PENDING_REAL_BACKUP_PROOF', 'installedAtUTC': signing.stamp(installed_at),
                           'source': 'e32cfb9105c2652fab8c2065af7280bf7dc76ec9',
                           'expected': {str(path): sha(secure(path)) for path in (ACTIVE, ROOT / 'config.json', RECOVERY)}}
        exclusive(stage / 'recovery-expected.json', json.dumps(recovery_record, indent=2).encode(), 0o600)
        SAFE.update(status='DEFAULT_OFF_SETUP_VERIFIED', installedAtUTC=signing.stamp(installed_at),
                    defaultOffFlagsVerified=True, exactFunctionsEnvironmentVerified=True,
                    authDatabaseStoragePreserved=True, loginPreserved=True, existingTimersPreserved=True,
                    sameImageHealthy=True, composeModelVerified=True, recoveryCopyMatches=True,
                    selectedRecoveryHashesRecordedPrivately=True, sourceHashesVerified=True,
                    installedCheck='CHECKED', freshRun='HEALTHY_NOT_DUE', newTimersActiveEnabled=True,
                    backupProofCompleted=False, expiry=report['clients'])
    except Exception as error:
        SAFE.update(status='STOPPED_BEFORE_ACTIVE_CHANGE', failedPhase=PHASE, reason=type(error).__name__,
                    guard=error.code if isinstance(error, GuardStop) else None)
        if replacement_attempted and not active_written:
            try:
                observed = secure(ACTIVE)
                active_written = replacement_state(observed, original, candidate) == 'CANDIDATE'
                SAFE['configurationReplaced'] = active_written
            except Exception:
                SAFE['status'] = 'RECOVERY_REQUIRED_UNKNOWN_STATE'
        if active_written:
            phase('RECOGNIZED_FAILURE_ROLLBACK')
            try:
                if enabled:
                    command(['systemctl', 'disable', '--now', *TIMERS], recovery=True)
                    SAFE['newTimersEnabled'] = False
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                require(secure(ACTIVE) in (original, candidate), 'ROLLBACK_UNKNOWN_ACTIVE_BYTES')
                # Existing renewal source unchanged; permit its commands only in recovery window.
                signing.command = lambda args, data=None: command(args, data, recovery=True)
                observed = json.loads(signing.command(['docker', 'inspect', *renewal.NAMES]))
                require(len(observed) == len(before), 'ROLLBACK_UNKNOWN_SERVICES')
                for item, old in zip(observed, before):
                    require(item['Name'] == old['Name'] and item['Image'] == old['Image'], 'ROLLBACK_UNKNOWN_IDENTITY')
                require([{'id': x['Id'], 'startedAt': x['State']['StartedAt']} for x in observed[1:]] == baseline['untouchedContainers']
                        and all(renewal.runtime_env(a) == renewal.runtime_env(b) for a, b in zip(before[1:], observed[1:])), 'ROLLBACK_UNRELATED_DRIFT')
                require(renewal.runtime_env(observed[0]) in (renewal.runtime_env(before[0]), expected_env), 'ROLLBACK_UNKNOWN_FUNCTIONS_ENV')
                signing.atomic(ACTIVE, original); host.activate(ACTIVE)
                old_env = renewal.runtime_env(before[0])
                rollback_expected = {'functionsImageId': before[0]['Image'],
                    'otherEnvironmentSha256': sha(json.dumps({k: v for k, v in old_env.items() if k != renewal.PAIR}, sort_keys=True).encode()),
                    'untouchedContainers': baseline['untouchedContainers']}
                # Prior runtime has no pair; host.verify expects .get(PAIR)==None.
                host.verify(None, rollback_expected)
                rolled = host.inspect()
                require(renewal.runtime_env(rolled[0]) == old_env and secure(ACTIVE) == original, 'ROLLBACK_PRIOR_RUNTIME')
                require(all(renewal.runtime_env(a) == renewal.runtime_env(b) for a, b in zip(before[1:], rolled[1:])), 'ROLLBACK_OTHER_ENVIRONMENTS')
                require(secure(LOGIN) == login_raw and timer_state(EXISTING, recovery=True) == old_timers, 'ROLLBACK_EXISTING_LOGIN_TIMERS')
                SAFE['status'] = 'ROLLED_BACK_ACTUAL_ORIGINAL_REVIEW_REQUIRED'
            except Exception:
                SAFE['status'] = 'RECOVERY_REQUIRED_UNKNOWN_STATE'
        print(json.dumps(SAFE), flush=True)
        return 2
    finally:
        os.close(lock)
    print(json.dumps(SAFE), flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(setup())
    except Exception as error:
        print(json.dumps({**SAFE, 'status': 'STOPPED_NO_SETUP_CONTINUATION', 'failedPhase': PHASE, 'reason': type(error).__name__,
                          'guard': error.code if isinstance(error, GuardStop) else None}), flush=True)
        raise SystemExit(2)
