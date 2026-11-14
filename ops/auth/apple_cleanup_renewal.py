#!/usr/bin/env python3
"""Operator-only Apple cleanup pair renewal; install/use requires separate approval."""
import argparse
import copy
import fcntl
import json
import os
import pathlib
import re
import stat
import time

import apple_renewal as signing

PAIR = 'CUSTOMER_APPLE_REVOCATION_CLIENTS'
ENCRYPTION = 'CUSTOMER_APPLE_ENCRYPTION_KEY'
CLIENTS = {'ios': 'com.barberplusplus.customer', 'web': 'com.barberplusplus.authentication.prod.web'}
NAMES = ('supabase-edge-functions', 'supabase-auth', 'supabase-db', 'supabase-storage')
TEAM = 'D49RFZQ6BT'
ROOT = '/etc/barber-release/apple-cleanup-renewal'
CONFIG = ROOT + '/config.json'
LOCK = '/var/lib/barber-release-backend/backend.lock'
ACTIVE_PHASES = {'PREPARED', 'CONFIGURED'}


def validate_config(config, installed=False):
    fields = {'environment', 'teamId', 'keyId', 'keyFile', 'overrideFile', 'composeDirectory', 'composeFile', 'stateDirectory', 'backendLockFile', 'imageIds'}
    if set(config) != fields or config['environment'] != 'production' or config['teamId'] != TEAM:
        raise ValueError('UNREVIEWED_CONFIGURATION')
    if not re.fullmatch(r'[A-Z0-9]{10}', str(config['keyId'])):
        raise ValueError('UNREVIEWED_KEY_ID')
    if set(config['imageIds']) != set(NAMES) or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', str(v)) for v in config['imageIds'].values()):
        raise ValueError('UNREVIEWED_IMAGES')
    if installed:
        expected = {'keyFile': '/etc/barber-release/apple-renewal/signing-key.p8',
                    'overrideFile': '/etc/barber-release/prepared-backend-runtime.override.json',
                    'composeDirectory': '/root/supabase/docker',
                    'composeFile': '/root/supabase/docker/docker-compose.yml',
                    'stateDirectory': ROOT + '/state', 'backendLockFile': LOCK}
        if any(config[k] != v for k, v in expected.items()):
            raise ValueError('UNREVIEWED_INSTALL_PATHS')


def private_directory(path):
    info = pathlib.Path(path).lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('UNSAFE_STATE_DIRECTORY')


def function_env(document):
    env = document['services']['functions']['environment']
    if not isinstance(env, dict) or env.get('APP_ENV') != 'production' or env.get('APP_URL') != 'https://www.barberplusplus.com':
        raise ValueError('WRONG_DEPLOYMENT')
    if env.get('SUPABASE_URL') != 'http://api-gw:8000' or env.get('CUSTOMER_ACCOUNT_DELETION_BACKEND_URL') != 'http://api-gw:8000' or env.get('CUSTOMER_PUBLIC_API_URL') != 'https://srv1073968.hstgr.cloud':
        raise ValueError('WRONG_BACKEND_BINDING')
    if not isinstance(env.get(ENCRYPTION), str) or not re.fullmatch(r'[a-f0-9]{64}', env[ENCRYPTION]):
        raise ValueError('ENCRYPTION_MUST_ALREADY_EXIST')
    return env


def credentials(document, config, now):
    env = function_env(document)
    pair = json.loads(env[PAIR])
    if not isinstance(pair, dict) or set(pair) != set(CLIENTS):
        raise ValueError('INCOMPLETE_CLIENT_PAIR')
    metadata = {}
    for platform, client in CLIENTS.items():
        value = pair[platform]
        if not isinstance(value, dict) or set(value) != {'clientId', 'clientSecret'} or value['clientId'] != client:
            raise ValueError('WRONG_CLIENT_PAIR')
        claims = signing.validate(value['clientSecret'], {**config, 'clientId': client}, now)
        # The existing signing verifier checks signature, identity and lifetime.
        metadata[platform] = {'expiresAt': claims['exp'], 'issuedAt': claims['iat']}
    return pair, metadata


def summary(metadata, now, status):
    remaining = min(v['expiresAt'] - now for v in metadata.values())
    return {'status': status, 'checkedAt': signing.stamp(now),
            'severity': 'CRITICAL' if remaining <= 7 * 86400 else 'WARNING' if remaining <= signing.RENEW_BEFORE else 'OK',
            'due': remaining <= signing.RENEW_BEFORE,
            'clients': {k: {'clientId': CLIENTS[k], 'expiresAt': signing.stamp(v['expiresAt']),
                            'renewAfter': signing.stamp(v['expiresAt'] - signing.RENEW_BEFORE),
                            'secondsToExpiry': v['expiresAt'] - now} for k, v in metadata.items()}}


def replace_pair(document, pair):
    changed = copy.deepcopy(document)
    changed['services']['functions']['environment'][PAIR] = json.dumps(pair, sort_keys=True, separators=(',', ':'))
    return changed


def runtime_env(container):
    return dict(value.split('=', 1) for value in container['Config']['Env'] if '=' in value)


class Host:
    def __init__(self, config):
        self.c = config

    def inspect(self):
        values = json.loads(signing.command(['docker', 'inspect', *NAMES]))
        if not isinstance(values, list) or len(values) != len(NAMES):
            raise ValueError('UNEXPECTED_RUNTIME')
        for name, item in zip(NAMES, values):
            if item.get('Name') != '/' + name or item['Image'] != self.c['imageIds'][name]:
                raise ValueError('RUNTIME_IDENTITY_DRIFT')
            if not item['State'].get('Running') or item['State'].get('Health', {}).get('Status') != 'healthy':
                raise RuntimeError('RUNTIME_UNHEALTHY')
        return values

    def compose(self, path):
        return ['docker', 'compose', '--project-directory', self.c['composeDirectory'], '--env-file', str(pathlib.Path(self.c['composeDirectory']) / '.env'), '-f', self.c['composeFile'], '-f', str(path)]

    def preflight(self, document, active):
        current = self.inspect()
        env = runtime_env(current[0])
        expected = function_env(document)
        if env.get(PAIR) != expected[PAIR] or env.get(ENCRYPTION) != expected[ENCRYPTION]:
            raise ValueError('CREDENTIAL_SOURCE_DRIFT')
        for key in ('APP_ENV', 'APP_URL', 'SUPABASE_URL', 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', 'CUSTOMER_PUBLIC_API_URL'):
            if env.get(key) != expected[key]:
                raise ValueError('RUNTIME_BINDING_DRIFT')
        rendered = signing.command(self.compose(active) + ['config', '--hash', 'functions']).decode().strip().split()
        if len(rendered) != 2 or rendered[0] != 'functions' or rendered[1] != current[0]['Config']['Labels'].get('com.docker.compose.config-hash'):
            raise ValueError('COMPOSE_MODEL_DRIFT')
        other = {k: v for k, v in env.items() if k != PAIR}
        return {'functionsImageId': current[0]['Image'], 'otherEnvironmentSha256': signing.sha(json.dumps(other, sort_keys=True).encode()),
                'untouchedContainers': [{'id': x['Id'], 'startedAt': x['State']['StartedAt']} for x in current[1:]]}

    def validate_candidate(self, path):
        signing.command(self.compose(path) + ['config', '--quiet'])

    def activate(self, path):
        signing.command(self.compose(path) + ['up', '-d', '--no-deps', '--pull', 'never', 'functions'])

    def verify(self, pair_value, before):
        current = None
        for _ in range(60):
            try:
                current = self.inspect()
                break
            except RuntimeError:
                time.sleep(1)
        if current is None:
            raise RuntimeError('FUNCTIONS_HEALTH_TIMEOUT')
        env = runtime_env(current[0])
        other = {k: v for k, v in env.items() if k != PAIR}
        if env.get(PAIR) != pair_value or current[0]['Image'] != before['functionsImageId'] or signing.sha(json.dumps(other, sort_keys=True).encode()) != before['otherEnvironmentSha256']:
            raise ValueError('UNRELATED_FUNCTIONS_ENV_CHANGED')
        if [{'id': x['Id'], 'startedAt': x['State']['StartedAt']} for x in current[1:]] != before['untouchedContainers']:
            raise ValueError('UNRELATED_SERVICE_RESTARTED')


def rollback(config, host, state, now):
    directory = pathlib.Path(config['stateDirectory'])
    backup = pathlib.Path(state['backup'])
    if backup.parent != directory or not re.fullmatch(r'override-before-[0-9]+\.json', backup.name):
        raise ValueError('UNRECOGNIZED_BACKUP')
    active = pathlib.Path(config['overrideFile'])
    current, old = signing.private_bytes(active), signing.private_bytes(backup)
    if signing.sha(old) != state['beforeSha256'] or signing.sha(current) not in (state['beforeSha256'], state['afterSha256']):
        raise ValueError('RECOVERY_CONFIGURATION_DRIFT')
    credentials(json.loads(old), config, now)
    host.validate_candidate(backup)
    signing.atomic(active, old)
    host.activate(active)
    host.verify(function_env(json.loads(old))[PAIR], state['beforeRuntime'])


def renew(config, host, now, check_only=False):
    validate_config(config)
    directory = pathlib.Path(config['stateDirectory'])
    private_directory(directory)
    journal = directory / 'state.json'
    previous = json.loads(signing.private_bytes(journal)) if journal.exists() else {}
    if previous and (not isinstance(previous, dict) or previous.get('phase') not in ACTIVE_PHASES | {'HEALTHY_NOT_DUE', 'RENEWED', 'ROLLED_BACK'}):
        raise ValueError('UNRECOGNIZED_RENEWAL_STATE')
    config_hash = signing.sha(json.dumps(config, sort_keys=True).encode())
    if previous.get('phase') in ACTIVE_PHASES:
        if previous.get('configurationSha256') != config_hash:
            raise ValueError('RECOVERY_IDENTITY_DRIFT')
        if check_only:
            raise RuntimeError('RECOVERY_REQUIRED')
        rollback(config, host, previous, now)
        signing.record(journal, {**previous, 'phase': 'ROLLED_BACK', 'checkedAt': signing.stamp(now)})
        raise RuntimeError('INTERRUPTED_ROTATION_RESTORED')
    old = signing.private_bytes(config['overrideFile'])
    document = json.loads(old)
    _, metadata = credentials(document, config, now)
    before = host.preflight(document, config['overrideFile'])
    report = summary(metadata, now, 'CHECKED' if check_only else 'HEALTHY_NOT_DUE')
    if check_only:
        return report
    if not report['due']:
        signing.record(journal, {'phase': 'HEALTHY_NOT_DUE', **report})
        return report
    # Both subjects renew together. This helper never creates/rotates encryption.
    pair = {platform: {'clientId': client, 'clientSecret': signing.issue({**config, 'clientId': client}, now)} for platform, client in CLIENTS.items()}
    changed = replace_pair(document, pair)
    _, next_metadata = credentials(changed, config, now)
    candidate = json.dumps(changed, indent=2).encode()
    prepared = directory / 'candidate.json'
    signing.atomic(prepared, candidate)
    try:
        host.validate_candidate(prepared)
    except Exception:
        prepared.unlink(missing_ok=True)
        raise
    backup = directory / ('override-before-' + str(time.time_ns()) + '.json')
    signing.atomic(backup, old)
    state = {'phase': 'PREPARED', 'checkedAt': signing.stamp(now), 'configurationSha256': config_hash,
             'beforeSha256': signing.sha(old), 'afterSha256': signing.sha(candidate), 'backup': str(backup), 'beforeRuntime': before}
    signing.record(journal, state)
    try:
        signing.atomic(config['overrideFile'], candidate)
        state['phase'] = 'CONFIGURED'
        signing.record(journal, state)
        host.activate(config['overrideFile'])
        host.verify(function_env(changed)[PAIR], before)
        # Commit completion within the recovery boundary, not after it.
        report = summary(next_metadata, now, 'RENEWED')
        signing.record(journal, {**state, **report, 'phase': 'RENEWED'})
    except Exception:
        rollback(config, host, state, now)
        signing.record(journal, {**state, 'phase': 'ROLLED_BACK'})
        raise
    prepared.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Metadata-only expiry check; never issues/replaces credentials')
    args = parser.parse_args()
    if os.geteuid() != 0 or os.uname().nodename.split('.')[0] != 'srv1073968':
        raise ValueError('REVIEWED_DB_HOST_ONLY')
    config = json.loads(signing.private_bytes(CONFIG))
    validate_config(config, installed=True)
    descriptor = os.open(LOCK, (os.O_RDONLY if args.check else os.O_RDWR) | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r' if args.check else 'r+') as lock:
        info = os.fstat(lock.fileno())
        if info.st_uid != 0 or info.st_mode & 0o077 or not stat.S_ISREG(info.st_mode):
            raise ValueError('UNSAFE_EXISTING_BACKEND_LOCK')
        fcntl.flock(lock, fcntl.LOCK_EX)
        report = renew(config, Host(config), int(time.time()), check_only=args.check)
        print(json.dumps(report))
        return 2 if args.check and report['severity'] == 'CRITICAL' else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status': 'APPLE_CLEANUP_RENEWAL_FAILED', 'reason': type(error).__name__}))
        raise SystemExit(1)
