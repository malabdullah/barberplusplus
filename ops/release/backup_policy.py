#!/usr/bin/env python3
"""Shared, fail-closed production recovery policy. This never creates evidence."""
import datetime, json, math, os, pathlib, sys, time


def verify_backup_readiness(evidence, now=None):
    if not isinstance(evidence, dict): raise ValueError('Backup evidence must be an object')
    now = time.time() if now is None else now
    if type(now) not in (int, float) or not math.isfinite(now): raise ValueError('Invalid current time')

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


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2: raise ValueError('Expected one backup evidence file')
        # Deterministic CLI checks may specify a clock; backend imports never
        # read this environment variable or accept a caller-supplied clock.
        override = os.environ.get('BACKUP_CHECK_NOW_EPOCH')
        if override is not None and (not override.isascii() or not override.isdigit()):
            raise ValueError('BACKUP_CHECK_NOW_EPOCH must be an epoch timestamp')
        now = int(override) if override is not None else None
        verify_backup_readiness(json.loads(pathlib.Path(sys.argv[1]).read_text()), now)
    except (ValueError, OSError) as error:
        print('Backup readiness failed: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
    print('Backup readiness verified: recoverable point <=15m, restore <=2h, and healthy off-site database/object backups.')
