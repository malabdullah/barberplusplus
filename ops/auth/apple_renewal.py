#!/usr/bin/env python3
"""Renew the existing self-hosted Apple OAuth secret without touching user data."""
import argparse
import base64
import copy
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time

SECRET = 'GOTRUE_EXTERNAL_APPLE_SECRET'
LIFETIME = 180 * 86400
RENEW_BEFORE = 30 * 86400
ACTIVE_PHASES = {'PREPARED', 'CONFIGURED'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def decoded(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def private_bytes(path):
    path = pathlib.Path(path)
    with path.open('rb') as handle:
        info = os.fstat(handle.fileno())
        if path.is_symlink() or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('Private file ownership or permissions are unsafe')
        return handle.read()


def atomic(path, raw):
    path = pathlib.Path(path)
    if path.is_symlink():
        raise ValueError('Symlink refused')
    fd, temporary = tempfile.mkstemp(prefix='.apple-next-', dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def record(path, value):
    atomic(path, json.dumps(value, indent=2).encode())


def command(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError('Credential operation failed; no credential contents logged')
    return result.stdout


def raw_signature(der):
    if len(der) < 8 or der[0] != 48 or der[1] != len(der) - 2:
        raise ValueError('Invalid ECDSA sequence')
    position = 2
    values = []
    for _ in range(2):
        if position + 2 > len(der) or der[position] != 2:
            raise ValueError('Invalid ECDSA integer')
        length = der[position + 1]
        number = der[position + 2:position + 2 + length]
        if not number or len(number) != length or number[0] & 128:
            raise ValueError('Invalid ECDSA integer length/sign')
        value = int.from_bytes(number, 'big')
        if not 0 < value < 2 ** 256:
            raise ValueError('Invalid P-256 signature')
        values.append(value.to_bytes(32, 'big'))
        position += 2 + length
    if position != len(der):
        raise ValueError('Trailing signature data')
    return b''.join(values)


def der_signature(raw):
    if len(raw) != 64:
        raise ValueError('Invalid ES256 signature length')
    values = []
    for part in [raw[:32], raw[32:]]:
        value = part.lstrip(b'\0') or b'\0'
        if value[0] & 128:
            value = b'\0' + value
        values.append(bytes([2, len(value)]) + value)
    body = b''.join(values)
    return bytes([48, len(body)]) + body


def validate(token, config, now):
    header, payload, signature = token.split('.')
    head = json.loads(decoded(header))
    claims = json.loads(decoded(payload))
    if head != {'alg': 'ES256', 'kid': config['keyId']}:
        # Existing Apple-generated headers may include typ=JWT.
        if head != {'alg': 'ES256', 'kid': config['keyId'], 'typ': 'JWT'}:
            raise ValueError('Unexpected Apple signing identity')
    if claims.get('iss') != config['teamId'] or claims.get('sub') != config['clientId'] or claims.get('aud') != 'https://appleid.apple.com':
        raise ValueError('Unexpected Apple credential scope')
    if type(claims.get('iat')) is not int or type(claims.get('exp')) is not int or not 0 < claims['exp'] - claims['iat'] <= LIFETIME or claims['iat'] > now + 300:
        raise ValueError('Invalid Apple credential lifetime or clock')
    private_bytes(config['keyFile'])
    public = command(['openssl', 'pkey', '-in', config['keyFile'], '-pubout'])
    with tempfile.TemporaryDirectory() as directory:
        pub = pathlib.Path(directory) / 'public.pem'
        sig = pathlib.Path(directory) / 'signature.der'
        pub.write_bytes(public)
        sig.write_bytes(der_signature(decoded(signature)))
        command(['openssl', 'dgst', '-sha256', '-verify', str(pub), '-signature', str(sig)], (header + '.' + payload).encode())
    return claims


def issue(config, now):
    key = pathlib.Path(config['keyFile'])
    private_bytes(key)
    description = command(['openssl', 'pkey', '-in', str(key), '-text_pub', '-noout'])
    if b'prime256v1' not in description:
        raise ValueError('Apple key must use P-256')
    head = encoded(json.dumps({'alg': 'ES256', 'kid': config['keyId']}, separators=(',', ':')).encode())
    claims = {'iss': config['teamId'], 'iat': now, 'exp': now + LIFETIME, 'aud': 'https://appleid.apple.com', 'sub': config['clientId']}
    signing = head + '.' + encoded(json.dumps(claims, separators=(',', ':')).encode())
    signature = command(['openssl', 'dgst', '-sha256', '-sign', str(key)], signing.encode())
    token = signing + '.' + encoded(raw_signature(signature))
    validate(token, config, now)
    return token


def replace_secret(document, token):
    changed = copy.deepcopy(document)
    changed['services']['auth']['environment'][SECRET] = token
    return changed


def stamp(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()


def environment(container):
    return dict(value.split('=', 1) for value in container['Config']['Env'] if '=' in value)


def other_environment(container):
    return {key: value for key, value in environment(container).items() if key != SECRET}


class Host:
    def __init__(self, config):
        self.c = config

    def inspect(self):
        return json.loads(command(['docker', 'inspect', 'supabase-auth', 'supabase-db', 'supabase-edge-functions']))

    def compose(self, path):
        return ['docker', 'compose', '--project-directory', self.c['composeDirectory'], '--env-file', str(pathlib.Path(self.c['composeDirectory']) / '.env'), '-f', self.c['composeFile'], '-f', str(path)]

    def check(self, containers):
        if any(not x['State'].get('Running') or x['State'].get('Health', {}).get('Status') != 'healthy' for x in containers):
            raise RuntimeError('Existing production service is unhealthy')
        if containers[0]['Image'] != self.c['authImageId']:
            raise ValueError('Auth image changed; operator review required')

    def preflight(self, document, current):
        before = self.inspect()
        self.check(before)
        auth = before[0]
        values = environment(auth)
        if values.get(SECRET) != document['services']['auth']['environment'][SECRET] or values.get('GOTRUE_EXTERNAL_APPLE_CLIENT_ID') != self.c['clientId'] or values.get('GOTRUE_EXTERNAL_APPLE_ENABLED') != 'true':
            raise ValueError('Live Apple configuration drift')
        config_hash = command(self.compose(current) + ['config', '--hash', 'auth']).decode().strip().split()[-1]
        if config_hash != auth['Config']['Labels'].get('com.docker.compose.config-hash'):
            raise ValueError('Compose model drift; do not reapply unrelated changes')
        return {'authImageId': auth['Image'], 'otherEnvironmentSha256': sha(json.dumps(other_environment(auth), sort_keys=True).encode()), 'untouchedContainers': [{'id': x['Id'], 'startedAt': x['State']['StartedAt']} for x in before[1:]]}

    def validate_candidate(self, path):
        command(self.compose(path) + ['config', '--quiet'])

    def activate(self, path):
        command(self.compose(path) + ['up', '-d', '--no-deps', '--pull', 'never', 'auth'])

    def verify(self, token, before):
        for _ in range(60):
            current = self.inspect()
            if all(x['State'].get('Running') and x['State'].get('Health', {}).get('Status') == 'healthy' for x in current):
                break
            time.sleep(1)
        self.check(current)
        if environment(current[0]).get(SECRET) != token or current[0]['Image'] != before['authImageId'] or sha(json.dumps(other_environment(current[0]), sort_keys=True).encode()) != before['otherEnvironmentSha256']:
            raise ValueError('Auth changed outside the Apple credential')
        if [{'id': x['Id'], 'startedAt': x['State']['StartedAt']} for x in current[1:]] != before['untouchedContainers']:
            raise ValueError('Database or Functions unexpectedly restarted')


def rollback(config, host, state):
    active = pathlib.Path(config['overrideFile'])
    current = private_bytes(active)
    old = private_bytes(state['backup'])
    if sha(old) != state['beforeSha256'] or sha(current) not in [state['beforeSha256'], state['afterSha256']]:
        raise ValueError('Interrupted operation has configuration drift; operator review required')
    atomic(active, old)
    host.activate(active)
    host.verify(json.loads(old)['services']['auth']['environment'][SECRET], state['beforeRuntime'])


def renew(config, host, now, force=False):
    active = pathlib.Path(config['overrideFile'])
    directory = pathlib.Path(config['stateDirectory'])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != os.geteuid() or directory.stat().st_mode & 0o077:
        raise ValueError('Unsafe renewal state directory')
    journal = directory / 'state.json'
    previous = json.loads(private_bytes(journal)) if journal.exists() else {}
    if previous.get('phase') in ACTIVE_PHASES:
        rollback(config, host, previous)
        record(journal, {**previous, 'phase': 'ROLLED_BACK', 'checkedAt': stamp(now)})
        raise RuntimeError('Interrupted rotation restored; next service retry may renew')
    old = private_bytes(active)
    document = json.loads(old)
    current = document['services']['auth']['environment'][SECRET]
    claims = validate(current, config, now)
    before = host.preflight(document, active)
    if not force and claims['exp'] - now > RENEW_BEFORE:
        record(journal, {'phase': 'HEALTHY_NOT_DUE', 'checkedAt': stamp(now), 'expiresAt': stamp(claims['exp']), 'renewAfter': stamp(claims['exp'] - RENEW_BEFORE)})
        return {'status': 'HEALTHY_NOT_DUE', 'expiresAt': stamp(claims['exp'])}
    token = issue(config, now)
    changed = replace_secret(document, token)
    candidate = json.dumps(changed, indent=2).encode()
    prepared = directory / 'candidate.json'
    atomic(prepared, candidate)
    host.validate_candidate(prepared)
    backup = directory / ('override-before-' + str(time.time_ns()) + '.json')
    atomic(backup, old)
    state = {'phase': 'PREPARED', 'checkedAt': stamp(now), 'beforeSha256': sha(old), 'afterSha256': sha(candidate), 'backup': str(backup), 'beforeRuntime': before, 'expiresAt': stamp(now + LIFETIME)}
    record(journal, state)
    try:
        atomic(active, candidate)
        state['phase'] = 'CONFIGURED'
        record(journal, state)
        host.activate(active)
        host.verify(token, before)
    except Exception:
        rollback(config, host, state)
        record(journal, {**state, 'phase': 'ROLLED_BACK'})
        raise
    state.update(phase='RENEWED', renewedAt=stamp(now), renewAfter=stamp(now + LIFETIME - RENEW_BEFORE))
    record(journal, state)
    prepared.unlink(missing_ok=True)
    return {'status': 'RENEWED', 'expiresAt': state['expiresAt'], 'renewAfter': state['renewAfter']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='/etc/barber-release/apple-renewal/config.json')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run only as root on the production backend')
    config = json.loads(private_bytes(args.config))
    if config['environment'] != 'production' or not all(re.fullmatch(r'[A-Z0-9]{10}', config[key]) for key in ['teamId', 'keyId']) or not re.fullmatch(r'[a-zA-Z0-9.-]+', config['clientId']):
        raise ValueError('Invalid production Apple identity')
    # Serialize with the existing restricted backend release consumer.
    with pathlib.Path(config['backendLockFile']).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        print(json.dumps(renew(config, Host(config), int(time.time()), args.force)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print JWTs, Docker environment values or private keys.
        print(json.dumps({'status': 'APPLE_RENEWAL_FAILED', 'reason': type(error).__name__}))
        raise SystemExit(1)
