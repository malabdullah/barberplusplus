"""Selected-file recovery verifier. No CLI/network/decryption implementation.

The future approved runner supplies a reader for the exact pinned restic snapshot;
this module never invokes the broad daily database/Storage recovery harness.
"""
import hashlib
import json
import os
import pathlib
import re
import stat

import apple_cleanup_renewal as renewal

SELECTED = {
    '/etc/barber-release/prepared-backend-runtime.override.json': 'runtime-override.json',
    '/etc/barber-release/apple-cleanup-renewal/config.json': 'renewal-config.json',
    '/etc/barber-release/recovery/customer-apple-encryption-v1': 'encryption-v1',
}
TARGET_NAME = 'barber-apple-cleanup-verify-0743265'
MAX_FILE = 2 * 1024 * 1024


def verify(receipt, expected, setup_time, now, reader, *, ram_parent=pathlib.Path('/dev/shm')):
    """reader(snapshot,path)->bytes; only selected paths, no latest/broad extraction.

    Default target is fixed and exclusive. ram_parent injection is for disposable
    synthetic tests; the future root runner must use /dev/shm and verify tmpfs.
    expected is a private setup receipt, never a caller-chosen file allowlist.
    """
    if set(expected) != set(SELECTED) or any(not re.fullmatch(r'[a-f0-9]{64}', str(v)) for v in expected.values()):
        raise ValueError('UNREVIEWED_RECOVERY_MANIFEST')
    snapshot = receipt.get('object_snapshot')
    captured = renewal.signing.datetime.datetime.fromisoformat(receipt.get('captured_at', '').replace('Z', '+00:00'))
    verified = renewal.signing.datetime.datetime.fromisoformat(receipt.get('verified_at', '').replace('Z', '+00:00'))
    if captured.tzinfo is None or verified.tzinfo is None:
        raise ValueError('INVALID_RECEIPT_CLOCK')
    c, v = captured.timestamp(), verified.timestamp()
    flags = ('encrypted_offsite', 'database_restored', 'storage_restored', 'functions_restored', 'configuration_restored', 'isolated_target_removed')
    if receipt.get('policy') != 'daily-v1' or receipt.get('provider') != 'b2' or not isinstance(snapshot, str) or not re.fullmatch(r'[a-f0-9]{64}', snapshot):
        raise ValueError('WRONG_RECOVERY_RECEIPT')
    if not setup_time <= c <= v <= now or now - c > 26 * 3600 or any(receipt.get(k) is not True for k in flags):
        raise ValueError('STALE_OR_PRE_SETUP_RECEIPT')
    # The separately reviewed runner must also verify the unchanged original
    # daily receipt/system/repository binding through the existing backup policy.
    parent = pathlib.Path(ram_parent)
    if parent.is_symlink() or not parent.is_dir():
        raise ValueError('UNSAFE_RAM_PARENT')
    target = parent / TARGET_NAME
    target.mkdir(mode=0o700)  # Refuse every pre-existing target, even an old QA one.
    created = []
    primary_error = None
    try:
        for remote, name in SELECTED.items():
            raw = reader(snapshot, remote)
            if not isinstance(raw, bytes) or len(raw) > MAX_FILE or hashlib.sha256(raw).hexdigest() != expected[remote]:
                raise ValueError('RECOVERED_FILE_MISMATCH')
            path = target / name
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            created.append(path)
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(raw)
            del raw
        override = json.loads((target / 'runtime-override.json').read_bytes())
        config = json.loads((target / 'renewal-config.json').read_bytes())
        renewal.validate_config(config, installed=True)
        key = (target / 'encryption-v1').read_bytes()
        if key != renewal.function_env(override)[renewal.ENCRYPTION].encode():
            raise ValueError('RECOVERY_KEY_BINDING_MISMATCH')
        del key
    except BaseException as error:
        primary_error = error
    # No rmtree/glob/delete of arbitrary paths. Only our exact exclusive files.
    if target.is_symlink() or not target.is_dir() or set(x.name for x in target.iterdir()) != {x.name for x in created}:
        raise RuntimeError('RECOVERY_CLEANUP_REQUIRES_REVIEW') from primary_error
    for path in created:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise RuntimeError('RECOVERY_FILE_CLEANUP_REQUIRES_REVIEW') from primary_error
    for path in reversed(created):
        path.unlink()
    target.rmdir()
    if primary_error is not None:
        raise primary_error
    return {'status': 'SELECTED_CONFIGURATION_RECOVERY_VERIFIED', 'selectedFiles': len(SELECTED),
            'sameEncryptionKey': True, 'plaintextTargetRemoved': not target.exists(),
            'databaseOrStorageRestored': False, 'containerStarted': False, 'credentialExported': False}
