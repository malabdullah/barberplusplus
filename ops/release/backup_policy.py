#!/usr/bin/env python3
"""Shared, fail-closed production recovery policy. This never creates evidence."""
import datetime, json, math, os, pathlib, sys, time


def verify_backup_readiness(evidence, now=None, release_commit=None, system_id=None):
    if not isinstance(evidence, dict): raise ValueError('Backup evidence must be an object')
    now = time.time() if now is None else now
    if type(now) not in (int, float) or not math.isfinite(now): raise ValueError('Invalid current time')

    if evidence.get('policy') == 'daily-v1':
        return verify_daily(evidence, now, release_commit, system_id)

    def field(path):
        value = evidence
        for name in path.split('.'):
            if not isinstance(value, dict) or name not in value: raise ValueError('Missing backup evidence: ' + path)
            value = value[name]
        return value

    def required_true(path):
        if field(path) is not True: raise ValueError('Unverified backup requirement: ' + path)

    def bounded_age(path, limit, elapsed=0):
        value = field(path)
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0 or value + elapsed > limit:
            raise ValueError('Backup recovery limit exceeded or invalid: ' + path)

    def recent_timestamp(path, limit):
        value = field(path)
        if not isinstance(value, str): raise ValueError('Invalid backup timestamp: ' + path)
        try:
            stamp = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
            if stamp.tzinfo is None or stamp.utcoffset() is None: raise ValueError('Timezone required')
            age = now - stamp.timestamp()
        except (ValueError, OverflowError): raise ValueError('Invalid backup timestamp: ' + path) from None
        if not 0 <= age <= limit: raise ValueError('Stale or future-dated backup evidence: ' + path)
        return age

    evidence_age = recent_timestamp('checked_at', 300)
    recent_timestamp('latest_restore_drill.completed_at', 92 * 24 * 60 * 60)
    for path in ['offsite_destination', 'wal_archive.healthy', 'base_backup.healthy',
                 'object_backup.healthy', 'latest_restore_drill.database_restored',
                 'latest_restore_drill.storage_restored']:
        required_true(path)
    for path, limit in [('recoverable_point_age_seconds', 900), ('wal_archive.lag_seconds', 900),
                        ('base_backup.age_seconds', 90000), ('object_backup.age_seconds', 90000)]:
        bounded_age(path, limit, evidence_age)
    for path, limit in [('latest_restore_drill.achieved_rpo_seconds', 900),
                        ('latest_restore_drill.achieved_rto_seconds', 7200)]:
        bounded_age(path, limit)



def verify_daily(e, now, release_commit=None, system_id=None):
    """Validate original recovery receipts locally; never contact object storage."""
    import re
    def timestamp(name):
        value = e.get(name)
        if not isinstance(value, str): raise ValueError('Missing daily timestamp: ' + name)
        try:
            stamp = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
            if stamp.tzinfo is None: raise ValueError()
            result = stamp.timestamp()
        except (ValueError, OverflowError): raise ValueError('Invalid daily timestamp: ' + name) from None
        if not 0 <= now - result <= 26 * 3600: raise ValueError('Daily recovery copy is stale or future-dated')
        return result
    captured = timestamp('captured_at'); verified = timestamp('verified_at')
    if captured > verified: raise ValueError('Daily verification precedes capture')
    if e.get('provider') not in ('b2', 'r2-transition'): raise ValueError('Unapproved daily provider')
    if not system_id or e.get('system_id') != system_id: raise ValueError('Daily database identity mismatch')
    for name in ['base_backup', 'object_snapshot', 'recovery_lsn', 'repository']:
        if not isinstance(e.get(name), str) or not e[name]: raise ValueError('Daily recovery binding missing: ' + name)
    for name in ['encrypted_offsite', 'database_restored', 'storage_restored', 'functions_restored', 'configuration_restored', 'isolated_target_removed']:
        if e.get(name) is not True: raise ValueError('Daily restoration not verified: ' + name)
    rto = e.get('restore_seconds')
    if type(rto) not in (int, float) or not math.isfinite(rto) or not 0 < rto <= 7200: raise ValueError('Daily restore time invalid')
    if e['provider'] == 'r2-transition':
        # Operator-authorized exception is bound to one exact main release.
        if not isinstance(release_commit, str) or not re.fullmatch('[a-f0-9]{40}', release_commit) or e.get('release_commit') != release_commit:
            raise ValueError('Transition recovery copy belongs to another release')
        expiry = e.get('expires_at')
        try:
            end = datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00'))
            if end.tzinfo is None or not verified <= now < end.timestamp() <= captured + 26 * 3600: raise ValueError()
        except (AttributeError, TypeError, ValueError, OverflowError): raise ValueError('Transition recovery authorization expired or invalid') from None

if __name__ == '__main__':
    try:
        if len(sys.argv) not in (2, 3, 4): raise ValueError('Expected evidence file, optional system identity and release commit')
        # Deterministic CLI checks may specify a clock; backend imports never
        # read this environment variable or accept a caller-supplied clock.
        override = os.environ.get('BACKUP_CHECK_NOW_EPOCH')
        if override is not None and (not override.isascii() or not override.isdigit()):
            raise ValueError('BACKUP_CHECK_NOW_EPOCH must be an epoch timestamp')
        now = int(override) if override is not None else None
        evidence = json.loads(pathlib.Path(sys.argv[1]).read_text())
        verify_backup_readiness(evidence, now, release_commit=sys.argv[3] if len(sys.argv) == 4 else None, system_id=sys.argv[2] if len(sys.argv) >= 3 else None)
    except (ValueError, OSError) as error:
        print('Backup readiness failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
    print('Backup readiness verified: daily encrypted recovery copy <=26h with isolated restore.' if evidence.get('policy') == 'daily-v1' else 'Backup readiness verified: recoverable point <=15m, restore <=2h, and healthy off-site database/object backups.')
