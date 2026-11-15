#!/usr/bin/env python3
"""Proposed stdin-only DB-host recovery check. Requires future explicit approval.

No CLI choices, installation, configuration writes, operator retries or broad restore.
Restic may make internal encrypted-pack/network reads; this is no HTTP count claim.
Importing this file performs no I/O. execute(FakeHost) is the local test seam.
"""
import contextlib
import datetime
import fcntl
import hashlib
import json
import math
import os
import pathlib
import re
import selectors
import signal
import stat
import subprocess
import sys
import time
import types

SOURCE = 'e32cfb9105c2652fab8c2065af7280bf7dc76ec9'
INSTALL = 1794644721  # Actual 2026-11-14T08:25:21Z installation, not preparation.
MAX_FILE = 2 * 1024 * 1024
MAX_JSON = 65536
RESTIC = '/var/lib/barber-release-backend/tools/restic-v0.19.1'
RESTIC_SHA256 = '20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'
DB_IMAGE = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
BUCKET = 'barber-production-recovery-malabdullah-20261012'
ENDPOINT = 'https://s3.us-east-005.backblazeb2.com'
REPOSITORY = 's3:' + ENDPOINT + '/' + BUCKET + '/production/v1/objects-v1'
BACKUP = '/etc/barber-backup/config.json'
B2 = '/etc/barber-backup/b2.json'
PASSWORD = '/etc/barber-backup/restic.password'
BINDING = '/var/lib/barber-backup/repository-binding.json'
RECEIPT = '/etc/barber-release/backup-readiness.json'
EXPECTED = '/etc/barber-release/apple-cleanup-renewal/bootstrap/recovery-expected.json'
OVERRIDE = '/etc/barber-release/prepared-backend-runtime.override.json'
CONFIG = '/etc/barber-release/apple-cleanup-renewal/config.json'
KEY_COPY = '/etc/barber-release/recovery/customer-apple-encryption-v1'
SELECTED = (OVERRIDE, CONFIG, KEY_COPY)
PRIVATE = (BACKUP, B2, PASSWORD, BINDING, RECEIPT, EXPECTED) + SELECTED
LOCKS = ('/var/lib/barber-release-backend/backend.lock', '/var/lib/barber-backup/daily.lock')
TARGET = pathlib.Path('/dev/shm/barber-apple-cleanup-verify-0743265')
LEASE = pathlib.Path(str(TARGET) + '.lease.json')
FLAGS = ('CUSTOMER_ACCOUNT_DELETION_ENABLED', 'CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED', 'CUSTOMER_APPLE_REVOCATION_ENABLED')
# Filled from the already-reviewed public source, never live secrets.
MODULE_HASHES = {'apple_renewal': '810d3cb8fc618b70c8bb4a8e05c3306753ea4dba9d5515cf0ec20aa19b08ee23', 'apple_cleanup_renewal': '7bd0458b3989c3b394e302d78e2b2e29619abb0d86cbc37a70903b1e0c5b97e6', 'apple_cleanup_recovery': 'cf25b0a2b9f817bcb60c77a6c79e4930cd3be3597c3a44654c93245903b252d4', 'backup_policy': '9b7f45ef3390d80d662c064e162740b16be694dec6e0e63322057cc2ac7802c4'}
CONFIG_MODEL = {'environment': 'production', 'teamId': 'D49RFZQ6BT', 'keyId': 'G2ANJ69763', 'keyFile': '/etc/barber-release/apple-renewal/signing-key.p8', 'overrideFile': '/etc/barber-release/prepared-backend-runtime.override.json', 'composeDirectory': '/root/supabase/docker', 'composeFile': '/root/supabase/docker/docker-compose.yml', 'stateDirectory': '/etc/barber-release/apple-cleanup-renewal/state', 'backendLockFile': '/var/lib/barber-release-backend/backend.lock', 'imageIds': {'supabase-edge-functions': 'sha256:2781daf92394db91f7e94129cc3d04ec474ad16a8fe64b3fbeef6e7d557ab120', 'supabase-auth': 'sha256:385184459f57569c54c25209f51f3b2be99ddd7c4ce9e3555b5d3eea8447b7cf', 'supabase-db': 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00', 'supabase-storage': 'sha256:c8eb9858eafec891a97c27125470aaad54703c3f4eb4d55ca7f1bf6c6411febf'}}
INSPECT_TEMPLATE = '{"image":{{json .Image}},"running":{{json .State.Running}},"healthy":{{if .State.Health}}{{eq .State.Health.Status "healthy"}}{{else}}false{{end}}}'
INSPECT = ['docker', 'inspect', '--type', 'container', '--format', INSPECT_TEMPLATE, 'supabase-db']
SYSTEM_SQL = "begin transaction read only; set local statement_timeout='5s'; set local lock_timeout='1s'; select jsonb_build_object('systemId',system_identifier::text) from pg_control_system(); rollback;"
SYSTEM = ['docker', 'exec', 'supabase-db', 'psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', SYSTEM_SQL]
BASE_ENV = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}
RESTIC_BASE = [RESTIC, '--no-cache', '--no-lock']
HEX = re.compile('[a-f0-9]{64}')


def require(ok):
    if not ok:
        raise ValueError('RECOVERY_CHECK_STOPPED')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def decode(raw):
    require(isinstance(raw, bytes) and len(raw) <= MAX_JSON)
    def unique(pairs):
        out = {}
        for key, value in pairs:
            require(key not in out)
            out[key] = value
        return out
    value = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(value, dict))
    return value


def timestamp(value):
    require(isinstance(value, str) and len(value) <= 64)
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)
    return parsed.timestamp()


def deadlines(env, now):
    names = ('BARBER_RECOVERY_ACTIVATED_UTC', 'BARBER_RECOVERY_STOP_UTC', 'BARBER_RECOVERY_HARD_UTC')
    require(all(re.fullmatch('[0-9]{10}', env.get(k, '')) for k in names))
    activation, stop, hard = (int(env[k]) for k in names)
    require(stop == activation + 2700 and hard == activation + 3600 and activation <= now < stop)
    return activation, stop, hard


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def canonical_parents(path):
    require(path.is_absolute() and path.resolve() == path)
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)


def bounded_command(args, env, limit, stop):
    """Bound actual pipe reads, memory, wall time, and the whole child process group."""
    remaining = min(120, stop - time.time())
    require(remaining > 0)
    proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env=env, start_new_session=True)
    end = time.monotonic() + remaining
    chunks, size = [], 0
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            while True:
                left = end - time.monotonic()
                require(left > 0)
                events = selector.select(left)
                require(bool(events))
                raw = os.read(proc.stdout.fileno(), min(65536, limit + 1 - size))
                if not raw:
                    break
                size += len(raw)
                require(size <= limit)
                chunks.append(raw)
        require(proc.wait(timeout=max(0.001, end - time.monotonic())) == 0)
        return b''.join(chunks)
    except BaseException:
        # No stderr, exception, provider result or partial plaintext is forwarded.
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=5)
        raise
    finally:
        proc.stdout.close()


class Host:
    """Fixed production boundary. All injectable fake I/O lives outside this class."""
    def __init__(self):
        self.stack = contextlib.ExitStack()
        self.seen = {}
        self.modules = {}
        self.lease_info = None
        self.lease_raw = None
        self.lease_created = False
        self.lease_removed = False
        self.target_absent_after_close = False
        self.metadata_commands = 0
        self.restic_commands = 0

    def now(self):
        return time.time()

    def private(self, path):
        require(path in PRIVATE)
        return self.read(path, MAX_FILE, private=True)

    def read(self, path, limit, private=False):
        path = pathlib.Path(path)
        canonical_parents(path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                    and before.st_size <= limit and not before.st_mode & (0o077 if private else 0o022))
            raw = bytearray()
            while True:
                piece = os.read(fd, min(65536, limit + 1 - len(raw)))
                if not piece:
                    break
                raw.extend(piece)
                require(len(raw) <= limit)
            require(fingerprint(before) == fingerprint(os.fstat(fd)) == fingerprint(path.lstat()))
            identity = (fingerprint(before), digest(raw))
            require(str(path) not in self.seen or self.seen[str(path)] == identity)
            self.seen[str(path)] = identity
            return bytes(raw)
        finally:
            os.close(fd)

    def open(self):
        require(len(sys.argv) == 1 and os.geteuid() == 0 and os.uname().nodename.split('.')[0] == 'srv1073968')
        self.activation, self.stop, self.hard = deadlines(os.environ, self.now())
        for name in LOCKS:
            path = pathlib.Path(name)
            canonical_parents(path)
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            self.stack.callback(os.close, fd)
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                    and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size == 0)
            fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            require(fingerprint(info) == fingerprint(path.lstat()))
            self.stack.callback(self.check_stat, path, info)
        for name, expected in MODULE_HASHES.items():
            raw = self.read('/usr/local/lib/barber-release/' + name + '.py', MAX_FILE)
            require(digest(raw) == expected and name not in sys.modules)
            module = types.ModuleType(name)
            sys.modules[name] = module
            exec(compile(raw, name + '.py', 'exec'), module.__dict__)
            self.modules[name] = module
        # Hash the existing pinned tool without executing/versioning or copying it.
        require(digest(self.read(RESTIC, 128 * 1024 * 1024)) == RESTIC_SHA256)
        return self.modules['backup_policy'], self.modules['apple_cleanup_recovery']

    @staticmethod
    def check_stat(path, info):
        require(fingerprint(info) == fingerprint(path.lstat()))

    def metadata(self):
        result = []
        for args in (INSPECT, SYSTEM):
            require(self.metadata_commands < 2)
            self.metadata_commands += 1
            result.append(decode(bounded_command(args, BASE_ENV, MAX_JSON, self.stop)))
        require(result[0] == {'image': DB_IMAGE, 'running': True, 'healthy': True})
        require(set(result[1]) == {'systemId'} and re.fullmatch('[0-9]{10,20}', result[1]['systemId']))
        return result[1]['systemId']

    def restic(self, operation, snapshot, path, env):
        require(self.restic_commands < 4)
        if operation == 'config':
            require(self.restic_commands == 0 and snapshot is None and path is None)
            args, limit = RESTIC_BASE + ['cat', 'config'], MAX_JSON
        else:
            require(operation == 'dump' and self.restic_commands in (1, 2, 3)
                    and isinstance(snapshot, str) and HEX.fullmatch(snapshot)
                    and path == SELECTED[self.restic_commands - 1])
            args, limit = RESTIC_BASE + ['dump', snapshot, path], MAX_FILE
        self.restic_commands += 1
        return bounded_command(args, env, limit, self.stop)

    def lease(self, receipt_raw):
        parent = TARGET.parent
        info = parent.lstat()
        require(parent.resolve() == parent and stat.S_ISDIR(info.st_mode) and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o1777 and not os.path.lexists(TARGET))
        mounts = pathlib.Path('/proc/self/mountinfo').read_text().splitlines()
        matches = [x.split(' - ', 1)[1].split()[0] for x in mounts if x.split(' - ', 1)[0].split()[4] == '/dev/shm']
        require(matches == ['tmpfs'])
        capacity = os.statvfs(parent)
        require(capacity.f_bavail * capacity.f_frsize >= 3 * MAX_FILE + 1024 * 1024)
        raw = json.dumps({'operation': 'selected-recovery-0743265', 'source': SOURCE,
                          'activation': self.activation, 'receiptSHA256': digest(receipt_raw)}, sort_keys=True).encode()
        fd = os.open(LEASE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.lease_created = True
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(os.dup(fd), 'wb') as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            self.lease_info, self.lease_raw = os.fstat(fd), raw
        finally:
            os.close(fd)

    def verify(self, verifier, receipt, expected, reader):
        # Unchanged installed verifier; never patch its functions or RAM path.
        return verifier.verify(receipt, expected, INSTALL, self.now(), reader)

    def stable(self):
        original = dict(self.seen)
        for path in original:
            limit = 128 * 1024 * 1024 if path == RESTIC else MAX_FILE
            self.read(path, limit, private=path in PRIVATE)
        require(self.seen == original)

    def close(self):
        try:
            if self.lease_created:
                require(self.lease_info is not None and not os.path.lexists(TARGET))
                require(fingerprint(LEASE.lstat()) == fingerprint(self.lease_info))
                fd = os.open(LEASE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    require(fingerprint(os.fstat(fd)) == fingerprint(self.lease_info)
                            and os.read(fd, MAX_JSON) == self.lease_raw)
                finally:
                    os.close(fd)
                require(fingerprint(LEASE.lstat()) == fingerprint(self.lease_info))
                LEASE.unlink()  # Only the proven operation-owned lease, never a stale one.
                self.lease_removed = True
                self.target_absent_after_close = not os.path.lexists(TARGET)
        finally:
            self.stack.close()


def validate_inputs(host, policy):
    raw = {name: host.private(name) for name in PRIVATE}
    config, creds, binding, receipt, installed = [decode(raw[n]) for n in (BACKUP, B2, BINDING, RECEIPT, EXPECTED)]
    require(config.get('enabled') is True and config.get('host') == 'srv1073968'
            and config.get('bucket') == BUCKET and config.get('endpoint') == ENDPOINT
            and config.get('prefix') == 'production/v1/' and config.get('resticSha256') == RESTIC_SHA256
            and isinstance(config.get('systemId'), str) and re.fullmatch('[0-9]{10,20}', config['systemId']))
    system = host.metadata()
    require(system == config['systemId'] == binding.get('systemId')
            and binding.get('databasePrefix') == 'production/v1/pg17-' + system + '/'
            and binding.get('objectPrefix') == 'production/v1/objects-v1/'
            and isinstance(binding.get('objectRepositoryId'), str) and HEX.fullmatch(binding['objectRepositoryId']))
    # Preserve and call the exact original policy; no date refresh or new PASS receipt.
    policy.verify_backup_readiness(receipt, now=host.now(), system_id=system)
    require(receipt.get('policy') == 'daily-v1' and receipt.get('provider') == 'b2'
            and receipt.get('repository') == 'private B2 production/v1/ repositories'
            and isinstance(receipt.get('object_snapshot'), str) and HEX.fullmatch(receipt['object_snapshot'])
            and INSTALL < timestamp(receipt.get('captured_at')) <= timestamp(receipt.get('verified_at')) <= host.now())
    require(installed.get('status') == 'INSTALLED_DEFAULT_OFF_PENDING_REAL_BACKUP_PROOF'
            and installed.get('source') == SOURCE and timestamp(installed.get('installedAtUTC')) == INSTALL)
    expected = installed.get('expected')
    require(isinstance(expected, dict) and set(expected) == set(SELECTED)
            and all(isinstance(x, str) and HEX.fullmatch(x) for x in expected.values()))
    require(all(digest(raw[name]) == expected[name] for name in SELECTED))
    require(decode(raw[CONFIG]) == CONFIG_MODEL)
    env = decode(raw[OVERRIDE])['services']['functions']['environment']
    require(isinstance(env, dict) and all(env.get(name) == 'false' for name in FLAGS))
    renewal = host.modules['apple_cleanup_renewal']
    require(renewal.function_env(decode(raw[OVERRIDE]))[renewal.ENCRYPTION].encode() == raw[KEY_COPY])
    require(creds.get('endpoint') == ENDPOINT and creds.get('bucket_name') == BUCKET and creds.get('name_prefix') == 'production/v1/')
    for name in ('key_id', 'application_key'):
        require(isinstance(creds.get(name), str) and 1 <= len(creds[name]) <= 256
                and all(33 <= ord(c) <= 126 for c in creds[name]))
    require(re.fullmatch(b'[a-f0-9]{64}\n?', raw[PASSWORD]))
    # No inherited proxies, custom CA/TLS overrides, credential-chain or WAL-G/DB secrets.
    environment = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'AWS_ACCESS_KEY_ID': creds['key_id'],
                   'AWS_SECRET_ACCESS_KEY': creds['application_key'], 'AWS_ENDPOINT': ENDPOINT,
                   'AWS_REGION': 'us-east-005', 'AWS_S3_FORCE_PATH_STYLE': 'true',
                   'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_SHARED_CREDENTIALS_FILE': '/dev/null',
                   'AWS_CONFIG_FILE': '/dev/null', 'RESTIC_REPOSITORY': REPOSITORY,
                   'RESTIC_PASSWORD_FILE': PASSWORD, 'GOMAXPROCS': '2'}
    return raw[RECEIPT], receipt, expected, binding['objectRepositoryId'], environment


def execute(host):
    result = {'status': 'STOP_SELECTED_RECOVERY_UNAVAILABLE', 'selectedFiles': 0,
              'sameEncryptionKey': False, 'originalPolicyVerified': False,
              'installedFilesMatchExpected': False, 'configuredDeletionFlagsOff': False,
              'plaintextTargetRemoved': False, 'temporaryLeaseRemoved': False,
              'targetAbsentAfterClose': False,
              'backupOrConfigurationOrBusinessWrites': False, 'credentialExported': False}
    try:
        policy, verifier = host.open()
        raw, receipt, expected, repo_id, env = validate_inputs(host, policy)
        result.update(originalPolicyVerified=True, installedFilesMatchExpected=True, configuredDeletionFlagsOff=True)
        host.lease(raw)
        remote = decode(host.restic('config', None, None, env))
        require(remote.get('id') == repo_id and type(remote.get('version')) is int and remote['version'] in (1, 2))
        proof = host.verify(verifier, receipt, expected, lambda snapshot, path: host.restic('dump', snapshot, path, env))
        require(proof == {'status': 'SELECTED_CONFIGURATION_RECOVERY_VERIFIED', 'selectedFiles': 3,
                          'sameEncryptionKey': True, 'plaintextTargetRemoved': True, 'databaseOrStorageRestored': False,
                          'containerStarted': False, 'credentialExported': False})
        host.stable()
        require(host.now() < host.hard and host.restic_commands == 4)
        result.update(status='SELECTED_RECOVERY_VERIFIED', selectedFiles=3, sameEncryptionKey=True,
                      plaintextTargetRemoved=True, receiptAgeSeconds=int(host.now() - timestamp(receipt['captured_at'])))
    except BaseException:
        pass  # Provider/SQL/file/JSON errors and private values never reach stdout/stderr.
    finally:
        try:
            host.close()
            result['temporaryLeaseRemoved'] = host.lease_removed
            result['targetAbsentAfterClose'] = host.target_absent_after_close
        except BaseException:
            result['status'] = 'STOP_RAM_CLEANUP_REQUIRES_REVIEW'
            result['plaintextTargetRemoved'] = False
        result['resticCommandsAttempted'] = host.restic_commands
        result['metadataCommandsAttempted'] = host.metadata_commands
    if result['status'] == 'SELECTED_RECOVERY_VERIFIED' and not result['temporaryLeaseRemoved']:
        result['status'] = 'STOP_RAM_CLEANUP_REQUIRES_REVIEW'
    if result['status'] == 'SELECTED_RECOVERY_VERIFIED' and host.now() >= host.hard:
        result['status'] = 'STOP_RECOVERY_WINDOW_EXPIRED'
    return result


if __name__ == '__main__':
    # SIGTERM/45min deadline unwind the unchanged verifier's scoped cleanup;
    # an uncatchable kill leaves the lease for reconciliation, never an auto-retry.
    def interrupted(_signum, _frame):
        raise RuntimeError('RECOVERY_INTERRUPTED')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    host = Host()
    try:
        _a, stop, _hard = deadlines(os.environ, time.time())
        signal.alarm(max(1, math.ceil(stop - time.time())))
        result = execute(host)
    except BaseException:
        result = {'status': 'STOP_SELECTED_RECOVERY_UNAVAILABLE', 'credentialExported': False}
    finally:
        signal.alarm(0)
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['status'] == 'SELECTED_RECOVERY_VERIFIED' else 2)
