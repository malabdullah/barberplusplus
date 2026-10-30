"""One nightly encrypted B2 recovery set. No retries or continuous cloud polling."""
import datetime
import fcntl
import json
import os
import pathlib
import subprocess
import shutil
import sys
import time
import runtime as m

STREAM = 'barber-backup-stream.service'
EVIDENCE = pathlib.Path('/etc/barber-release/backup-readiness.json')


def evidence(c, b, o, w, d, provider='b2'):
    """Bind the gate to the exact successful restore, never today's clock."""
    expected = 'REAL_B2_PHYSICAL_PITR_AND_STORAGE_RESTORE_PASS' if provider == 'b2' else 'REAL_R2_PHYSICAL_PITR_AND_STORAGE_RESTORE_PASS'
    if d['status'] != expected or not (c['systemId'] == b['systemId'] == w['systemId'] == d['systemId']):
        raise ValueError('Wrong recovery source or system')
    if d['baseBackup'] != b['backupName'] or d['objectSnapshot'] != o['snapshotId'] or d['verifiedRecoveryLsn'] != w['lsn']:
        raise ValueError('Recovery receipt differs from selected backup')
    if d['network'] != 'none' or type(d['publishedPorts']) is not int or d['publishedPorts'] != 0:
        raise ValueError('Recovery target was not isolated')
    if d['productionDatabaseRestoredOver'] is not False or d['productionDataEnteredLocalTest'] is not False:
        raise ValueError('Unsafe recovery target')
    for name in ['productionEnvAndComposeMatched', 'plaintextRecoveryTargetRemoved', 'disposableContainerRemoved']:
        if d[name] is not True: raise ValueError('Recovery verification incomplete')
    if d['recoveryDatabase']['recoveryComplete'] is not True: raise ValueError('Database recovery incomplete')
    for path in ['/root/supabase/docker/volumes/storage', '/root/supabase/docker/volumes/functions', '/var/lib/docker/volumes/supabase_db-config/_data']:
        proof = d['fileTreesMatched'][path]
        import re
        if type(proof['files']) is not int or proof['files'] < 0 or not re.fullmatch('[a-f0-9]{64}', proof['sha256']):
            raise ValueError('Missing verified file tree')
    return {'policy': 'daily-v1', 'provider': provider, 'system_id': c['systemId'],
            'captured_at': min(b['startedAt'], o['startedAt'], w['recoverablePointCreatedAt']),
            'verified_at': d['completedAt'], 'base_backup': b['backupName'], 'object_snapshot': o['snapshotId'],
            'recovery_lsn': w['lsn'], 'repository': d['encryptedOffHostSource'], 'encrypted_offsite': True,
            'database_restored': True, 'storage_restored': True, 'functions_restored': True,
            'configuration_restored': True, 'isolated_target_removed': True, 'restore_seconds': d['achievedRtoSeconds']}


def cleanup():
    subprocess.run(['systemctl', 'stop', 'barber-backup-full.service', 'barber-backup-objects.service', 'barber-backup-pulse.service'], check=True, timeout=60, capture_output=True)
    subprocess.run(['systemctl', 'stop', STREAM], check=True, timeout=45, capture_output=True)
    row = json.loads(m.sql("BEGIN READ ONLY; SELECT coalesce((SELECT json_build_object('active',active,'type',slot_type) FROM pg_replication_slots WHERE slot_name='barber_production_recovery'),'null'::json); COMMIT;"))
    if row:
        if row != {'active': False, 'type': 'physical'}: raise ValueError('Refuse to remove an active or unexpected slot')
        m.sql("SELECT pg_drop_replication_slot('barber_production_recovery');")


    lease = m.STATE/'daily-restore-lease.json'
    if lease.exists():
        state = json.loads(m.private(lease)); base = pathlib.Path(state['directory'])
        if state['container'] != 'barber-production-daily-b2-drill' or base.parent != pathlib.Path('/dev/shm') or not base.name.startswith('barber-daily-recovery-') or base.is_symlink():
            raise ValueError('Unrecognized interrupted recovery target')
        probe = subprocess.run(['docker','inspect',state['container']],capture_output=True,text=True,timeout=30)
        if probe.returncode == 0:
            container = json.loads(probe.stdout)[0]
            mounts = [x for x in container['Mounts'] if x['Destination']=='/recovery']
            if container['Image'] != m.PG_IMAGE or container['HostConfig']['NetworkMode'] != 'none' or len(mounts)!=1 or mounts[0]['Source']!=str(base):
                raise ValueError('Interrupted recovery identity mismatch')
            subprocess.run(['docker','rm','-f',state['container']],check=True,capture_output=True,timeout=60)
        if base.exists(): shutil.rmtree(base)
        lease.unlink()


def cycle(invoke, restore, finish):
    """Always stop the temporary WAL receiver, including on upload/restore failure."""
    try:
        invoke('stream')
        for mode in ['full', 'objects', 'pulse']: invoke(mode)
        return restore()
    finally:
        finish()


def main():
    if os.getuid() != 0: raise ValueError('Root operator required')
    m.STATE.mkdir(mode=0o700, exist_ok=True)
    lock = os.open(m.STATE/'daily.lock', os.O_CREAT | os.O_RDWR, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if sys.argv[1:] == ['cleanup']:
        cleanup(); return
    if sys.argv[1:]: raise ValueError('Unsupported daily operation')
    # Serialize against migration and Functions replacement, not customer traffic.
    with pathlib.Path('/var/lib/barber-release-backend/backend.lock').open('a') as release_lock:
        fcntl.flock(release_lock, fcntl.LOCK_EX)
        c = json.loads(m.private(m.CONFIG)); m.runtime(c)
        def invoke(mode):
            unit = STREAM if mode == 'stream' else 'barber-backup-'+mode+'.service'
            subprocess.run(['systemctl', 'start', unit], check=True, timeout=3700, capture_output=True)
            if mode == 'stream':
                for _ in range(20):
                    if m.sql("BEGIN READ ONLY; SELECT count(*) FROM pg_replication_slots WHERE slot_name='barber_production_recovery' AND active; COMMIT;").strip() == '1': return
                    time.sleep(1)
                raise ValueError('Temporary daily WAL receiver not active')
        import daily_restore
        d = cycle(invoke, daily_restore.run, cleanup)
        b, o, w = [json.loads(m.private(m.STATE/n)) for n in ['base-backup.json', 'object-backup.json', 'wal-point.json']]
        e = evidence(c, b, o, w, d)
        sys.path.insert(0, '/usr/local/lib/barber-release')
        from backup_policy import verify_backup_readiness
        verify_backup_readiness(e, system_id=c['systemId'])
        # Atomic private receipt; failed cycles never refresh successful evidence.
        from readiness import write
        write(EVIDENCE, e)
        print(json.dumps({'status': 'DAILY_B2_BACKUP_AND_RESTORE_VERIFIED', 'capturedAt': e['captured_at'], 'verifiedAt': e['verified_at']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Tool output may contain secrets; print only a classification.
        print(json.dumps({'status': 'DAILY_BACKUP_BLOCKED', 'reason': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
