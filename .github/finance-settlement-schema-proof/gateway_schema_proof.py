"""Replay only approved schema, compare real dumps, never invoke maintenance."""
import hashlib, importlib.util, json, pathlib, re, subprocess

HERE = pathlib.Path(__file__).resolve().parent

def replay_migrations(root, sql, docker, name):
    from driver import verify
    m = verify(root)
    spec = importlib.util.spec_from_file_location('reviewed_normalizer', root / 'scripts/normalize-schema.py')
    normalizer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(normalizer)
    if not re.fullmatch('barber-postgres-compat-[a-f0-9]{10}', name):
        raise ValueError('Synthetic isolated container required')

    def fingerprint():
        # Same reviewed production pg_dump transformation and behavioral
        # normalizer, changing only the owned synthetic container/socket.
        wrapper = '''set -euo pipefail
export PGHOST='' PGPORT='' PGUSER='' PGPASSWORD='' PGDATABASE=''
export EXTRA_FLAGS='--schema public' EXTRA_SED='/^--/d'
pg_dump() {
  docker exec -e 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=20000' ''' + name + ''' pg_dump -h /tmp -U postgres -d postgres "$@"
}
export -f pg_dump
'''
        result = subprocess.run(['/bin/bash'], input=wrapper + (root / 'ops/release/dump-schema.sh').read_text(), text=True, capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError('Synthetic schema-only dump failed')
        return hashlib.sha256(normalizer.behavioral_schema(result.stdout).encode()).hexdigest()

    def gateway():
        r = json.loads(sql("""select json_build_object('definitionMd5',md5(pg_get_functiondef(p.oid)),'aclMd5',md5(coalesce(p.proacl::text,'')),'definer',p.prosecdef,'owner',pg_get_userbyid(p.proowner),'signature',pg_get_function_identity_arguments(p.oid))from pg_proc p where p.oid='public.account_maintenance_gateway(text,jsonb)'::regprocedure;""").strip())
        if r != {'definitionMd5': m['approvedGatewayDefinitionMd5'], 'aclMd5': m['approvedGatewayAclMd5'], 'definer': True, 'owner': 'postgres', 'signature': 'p_action text, p_data jsonb'}:
            raise ValueError('Approved gateway definition/ACL mismatch')
        if sql('select (select count(*)from private.maintenance_configuration)+(select count(*)from private.maintenance_batches);').strip() != '0':
            raise ValueError('Maintenance tables must stay empty')
        return r

    for row in m['baselineMigrations']:
        sql((root / 'supabase/migrations' / row['name']).read_text())
    sql((HERE / 'gateway-schema-only.sql').read_text())
    before = gateway()
    baseline = fingerprint()
    if baseline != m['observedBaselineFingerprint']:
        print(json.dumps({'status': 'BASELINE_FINGERPRINT_MISMATCH', 'source': m['source'], 'actualBaselineFingerprint': baseline, 'expectedBaselineFingerprint': m['observedBaselineFingerprint'], 'candidateAccepted': False, 'productionAccess': False}))
        raise ValueError('Reconstructed baseline does not equal observed Live seal')
    for row in m['pendingMigrations']:
        sql((root / 'supabase/migrations' / row['name']).read_text())
    if sql("select enabled from private.settlement_runtime where singleton;").strip() != 'f':
        raise ValueError('Settlement runtime must ship disabled')
    if gateway() != before:
        raise ValueError('Gateway changed during app migrations')
    authz = json.loads(sql('''
    select json_build_object(
      'empty', (select count(*) from private.settlement_bank_entries)=0,
      'rls', (select relrowsecurity from pg_class where oid='private.settlement_bank_entries'::regclass),
      'noDirectAccess', (select bool_and(not has_table_privilege(role,'private.settlement_bank_entries','SELECT,INSERT,UPDATE,DELETE')) from (values ('anon'),('authenticated'),('service_role')) as roles(role)),
      'rpcRestricted', not has_function_privilege('anon','public.platform_settlement_reconciliation(text,jsonb)','EXECUTE')
          and not has_function_privilege('service_role','public.platform_settlement_reconciliation(text,jsonb)','EXECUTE')
          and has_function_privilege('authenticated','public.platform_settlement_reconciliation(text,jsonb)','EXECUTE'),
      'immutableTrigger', exists (select 1 from pg_trigger where tgrelid='private.settlement_bank_entries'::regclass and tgname='settlement_bank_entry_immutable' and tgenabled='O')
    );
    ''').strip())
    if set(authz) != {'empty','rls','noDirectAccess','rpcRestricted','immutableTrigger'} or not all(authz.values()):
        raise ValueError('Reconciliation security contract differs')
    candidate = fingerprint()
    if candidate == baseline:
        raise ValueError('Candidate must include its additive migrations')
    print(json.dumps({'status': 'GATEWAY_SCHEMA_PRESERVATION_PASS', 'source': m['source'], 'sourceSchemaSha256': m['sourceFileSha256']['supabase/schema.expected.sql'], 'baselineFingerprint': baseline, 'baselineMatchesObservedLiveSeal': True, 'candidateFingerprint': candidate, 'approvedGatewayPreserved': True, 'gateway': before, 'baselineMigrationCount': len(m['baselineMigrations']), 'pendingMigrationCount': len(m['pendingMigrations']), 'reconciliationReadback': authz, 'gatewayInvocations': 0, 'maintenanceRows': 0, 'productionAccess': False, 'executionReady': False}))
