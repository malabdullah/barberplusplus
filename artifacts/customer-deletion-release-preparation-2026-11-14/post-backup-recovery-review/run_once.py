#!/usr/bin/env python3
"""Future local one-shot SSH launcher; no IP discovery, firewall API or retry.

Requires the exact reviewed packet and a new protected, human-verified approval /
already-activated access receipt. This file and importing it perform no operation.
"""
import datetime
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
WORKTREE = HERE.parents[2]
PRIVATE = WORKTREE / '.release-private/post-backup-recovery-2026-11-15'
WRAPPER_SHA256 = '9902b775c3f4fe99732fc8105e3b7d676ea730f8e33d9148ec88ed85ee38ba1d'
WINDOW_KEYS = {'manifestSHA256', 'directHumanApprovalVerified', 'requestId', 'messageId',
               'target', 'sourceIPv4', 'activationEpoch', 'stopEpoch', 'hardEpoch',
               'originalFirewallProfile', 'temporaryFirewallProfile', 'originalRulesVerified', 'restorePathVerified'}
STATUSES = {'SELECTED_RECOVERY_VERIFIED', 'STOP_SELECTED_RECOVERY_UNAVAILABLE',
            'STOP_RAM_CLEANUP_REQUIRES_REVIEW', 'STOP_RECOVERY_WINDOW_EXPIRED'}
BOOLS = {'sameEncryptionKey', 'originalPolicyVerified', 'installedFilesMatchExpected',
         'configuredDeletionFlagsOff', 'plaintextTargetRemoved', 'temporaryLeaseRemoved',
         'targetAbsentAfterClose', 'backupOrConfigurationOrBusinessWrites', 'credentialExported'}


def require(ok):
    if not ok: raise ValueError('ONE_SHOT_LAUNCH_STOPPED')


def decode(raw):
    require(isinstance(raw, bytes) and len(raw) <= 16384)
    def unique(pairs):
        out = {}
        for k, v in pairs:
            require(k not in out)
            out[k] = v
        return out
    value = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(value, dict))
    return value


def window_guard(value, manifest_hash, now):
    require(isinstance(value, dict) and set(value) == WINDOW_KEYS)
    require(value['manifestSHA256'] == manifest_hash and value['directHumanApprovalVerified'] is True
            and value['originalRulesVerified'] is True and value['restorePathVerified'] is True)
    require(re.fullmatch('call_[A-Za-z0-9_-]{8,80}', str(value['requestId']))
            and re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', str(value['messageId'])))
    address = ipaddress.ip_address(value['sourceIPv4'])
    require(address.version == 4 and address.is_global and str(address) == value['sourceIPv4'])
    require(value['target'] == '72.61.164.64' and value['originalFirewallProfile'] == 367995
            and value['temporaryFirewallProfile'] == 400860)
    a, stop, hard = (value[k] for k in ('activationEpoch', 'stopEpoch', 'hardEpoch'))
    require(all(type(x) is int and 1000000000 <= x < 10000000000 for x in (a, stop, hard)))
    require(stop == a + 2700 and hard == a + 3600 and a <= now < stop)
    return a, stop, hard


def result_guard(value):
    require(isinstance(value, dict) and value.get('status') in STATUSES)
    if set(value) == {'status', 'credentialExported'}:
        require(value == {'status': 'STOP_SELECTED_RECOVERY_UNAVAILABLE', 'credentialExported': False})
        return value
    fields = BOOLS | {'status', 'selectedFiles', 'resticCommandsAttempted', 'metadataCommandsAttempted'}
    if 'receiptAgeSeconds' in value: fields.add('receiptAgeSeconds')
    require(set(value) == fields and all(type(value[k]) is bool for k in BOOLS))
    require(value['backupOrConfigurationOrBusinessWrites'] is False and value['credentialExported'] is False)
    for k, maximum in [('selectedFiles', 3), ('resticCommandsAttempted', 4), ('metadataCommandsAttempted', 2)]:
        require(type(value[k]) is int and 0 <= value[k] <= maximum)
    if 'receiptAgeSeconds' in value:
        require(type(value['receiptAgeSeconds']) is int and 0 <= value['receiptAgeSeconds'] <= 26 * 3600)
    if value['status'] == 'SELECTED_RECOVERY_VERIFIED':
        require(value.get('receiptAgeSeconds') is not None and value['selectedFiles'] == 3
                and value['resticCommandsAttempted'] == 4 and value['metadataCommandsAttempted'] == 2
                and all(value[k] for k in BOOLS - {'backupOrConfigurationOrBusinessWrites', 'credentialExported'}))
    return value


def private_read(path):
    require(path.resolve() == path and PRIVATE.resolve() == PRIVATE)
    parent = PRIVATE.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid() and stat.S_IMODE(parent.st_mode) == 0o700)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 16384)
        return os.read(fd, 16385)
    finally: os.close(fd)


def save_exclusive(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output, indent=2); output.write('\n'); output.flush(); os.fsync(output.fileno())


def ssh_command(a, stop, hard):
    return ['ssh', '-F', '/dev/null', '-T', '-i', '/Users/malabdullah/.ssh/codex_supabase_migration_ed25519',
            '-o', 'UserKnownHostsFile=/Users/malabdullah/.ssh/known_hosts', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectionAttempts=1',
            '-o', 'ConnectTimeout=10', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
            '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1', 'root@72.61.164.64',
            f'env BARBER_RECOVERY_ACTIVATED_UTC={a} BARBER_RECOVERY_STOP_UTC={stop} BARBER_RECOVERY_HARD_UTC={hard} python3 -B -']


def transport(args, source, stop):
    # One invocation, bounded bytes and duration; no stderr/private intermediate output.
    require(stop > time.time() and isinstance(source, bytes) and len(source) <= 65536)
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, start_new_session=True)
    end = time.monotonic() + min(1200, stop - time.time())
    try:
        chunks, size, sent = [], 0, 0
        os.set_blocking(proc.stdin.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            selector.register(proc.stdin, selectors.EVENT_WRITE)
            while selector.get_map():
                left = end - time.monotonic(); require(left > 0)
                events = selector.select(left); require(events)
                for key, _event in events:
                    if key.fileobj is proc.stdin:
                        sent += os.write(proc.stdin.fileno(), source[sent:sent + 4096])
                        if sent == len(source):
                            selector.unregister(proc.stdin); proc.stdin.close()
                    else:
                        raw = os.read(proc.stdout.fileno(), min(4096, 16385 - size))
                        if not raw:
                            require(sent == len(source)); selector.unregister(proc.stdout)
                        else:
                            size += len(raw); require(size <= 16384); chunks.append(raw)
        code = proc.wait(timeout=max(0.001, end - time.monotonic()))
        return code, result_guard(decode(b''.join(chunks)))
    except BaseException:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        proc.wait(timeout=5)
        raise
    finally:
        if not proc.stdin.closed: proc.stdin.close()
        proc.stdout.close()


def main():
    require(len(sys.argv) == 1)
    manifest_raw = (HERE / 'review-manifest.json').read_bytes()
    manifest = decode(manifest_raw)
    for name, wanted in manifest['files'].items():
        require(isinstance(name, str) and pathlib.PurePosixPath(name).name == name
                and hashlib.sha256((HERE / name).read_bytes()).hexdigest() == wanted)
    source = (HERE / 'recover_selected.py').read_bytes()
    require(hashlib.sha256(source).hexdigest() == WRAPPER_SHA256)
    approval = decode(private_read(PRIVATE / 'approved-access-window.json'))
    a, stop, hard = window_guard(approval, hashlib.sha256(manifest_raw).hexdigest(), time.time())
    # Must have separately read the direct human reply and activated/verified the exact rule.
    # The receipt does not itself replace owner authorization or browser approval policy.
    save_exclusive(PRIVATE / 'invocation-started.json', {'activationEpoch': a, 'wrapperSHA256': WRAPPER_SHA256, 'retryAllowed': False})
    result = {'status': 'STOP_TRANSPORT_UNCERTAIN_RESTORE_ACCESS_NO_RETRY'}
    try:
        code, proof = transport(ssh_command(a, stop, hard), source, stop)
        require((code == 0) == (proof['status'] == 'SELECTED_RECOVERY_VERIFIED'))
        result = {'sshExitCode': code, 'proof': proof}
    except BaseException:
        pass
    save_exclusive(PRIVATE / 'safe-result.json', {'completedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   'invocations': 1, 'retryAttempted': False, 'result': result,
                   'firewallRestorationStillRequired': True})
    print(json.dumps({'status': 'ATTEMPT_ENDED_RESTORE_ORIGINAL_FIREWALL_NOW', 'proofReturned': 'proof' in result}))
    return 0 if result.get('proof', {}).get('status') == 'SELECTED_RECOVERY_VERIFIED' else 2


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception:
        print(json.dumps({'status': 'STOP_LOCAL_LAUNCH_UNAVAILABLE_NO_RETRY'}))
        raise SystemExit(2)
