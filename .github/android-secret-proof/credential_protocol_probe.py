"""Synthetic-only Bind/redaction proof in the existing isolated PG container."""
import hashlib, json, subprocess
import credential_protocol as protocol

def run_probe(root, sql, docker, name):
    before = sql("select json_build_object('statement',current_setting('log_statement'),'errorStatement',current_setting('log_min_error_statement'),'parameter',current_setting('log_parameter_max_length'),'parameterError',current_setting('log_parameter_max_length_on_error')); ").strip()
    values = ["BARBER_SYNTHETIC_BIND_SENTINEL_plain", "BARBER_SYNTHETIC_BIND_SENTINEL_'quotes'", 'BARBER_SYNTHETIC_BIND_SENTINEL_\\n\\t\\bind', 'BARBER_SYNTHETIC_BIND_SENTINEL_`false`:variable$1', 'BARBER_SYNTHETIC_BIND_SENTINEL_\nactual newline\t', 'BARBER_SYNTHETIC_BIND_SENTINEL_صالون']
    header = "begin; set local log_statement='all'; set local log_min_error_statement='error';\n" + protocol.PARAMETER_REDACTION
    batch = header
    for value in values:
        expected = hashlib.md5(value.encode()).hexdigest()
        batch += "select md5(convert_from(decode($1,'base64'),'UTF8'))='" + expected + "' /* BARBER_BIND_ROUNDTRIP */\n" + protocol.bind_one(value)
    # Exactly the proposed credential statements, but conspicuously synthetic
    # values, network-isolated Vault and rollback. No Google credential exists.
    fcm = json.dumps({'syntheticOnly': True, 'marker': values[1] + values[2] + values[3] + values[4] + values[5]})
    wake = 'a' * 64
    batch += protocol.credential_statements(fcm, wake) + 'rollback;\n'
    def execute(data):
        return subprocess.run(['docker', 'exec', '-i', name, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'ECHO=none', '-v', 'VERBOSITY=sqlstate'], input=data.encode(), capture_output=True, timeout=60)
    result = execute(batch)
    lines = result.stdout.decode().splitlines()
    if result.returncode or lines[:len(values)] != ['t'] * len(values) or lines[len(values)] != 'CREATED_TWO' or lines[len(values)+1] != 't':
        raise ValueError('SYNTHETIC_BIND_OR_VAULT_ROUNDTRIP_FAILED')
    failure_value = 'BARBER_SYNTHETIC_BIND_SENTINEL_ERROR_' + values[3]
    failed = execute(header + 'select length(convert_from(decode($1,\'base64\'),\'UTF8\'))/0 /* BARBER_BIND_EXPECTED_ERROR */\n' + protocol.bind_one(failure_value))
    if failed.returncode == 0 or protocol.safe_sqlstate(failed.stderr) != '22012':
        raise ValueError('SYNTHETIC_EXPECTED_ERROR_MISSING')
    # Docker logs are inspected only in memory. No log or sentinel is emitted.
    logs = subprocess.run(['docker', 'logs', name], capture_output=True, timeout=30)
    raw = logs.stdout + logs.stderr
    if b'BARBER_BIND_ROUNDTRIP' not in raw or b'BARBER_BIND_EXPECTED_ERROR' not in raw or b'division by zero' not in raw:
        raise ValueError('STATEMENT_AND_ERROR_LOGGING_NOT_PROVEN')
    protected = [*values, fcm, wake, failure_value]
    if any(v.encode() in raw or protocol.encoded_parameter(v).encode() in raw for v in protected):
        raise ValueError('SYNTHETIC_BIND_PARAMETER_LEAK')
    if any(v.encode() in result.stdout + result.stderr + failed.stdout + failed.stderr for v in protected):
        raise ValueError('SYNTHETIC_CLIENT_OUTPUT_LEAK')
    after = sql("select json_build_object('statement',current_setting('log_statement'),'errorStatement',current_setting('log_min_error_statement'),'parameter',current_setting('log_parameter_max_length'),'parameterError',current_setting('log_parameter_max_length_on_error')); ").strip()
    if after != before or sql("select count(*)from vault.secrets where name in('customer_android_live_fcm','customer_android_live_dispatch_secret');").strip() != '0':
        raise ValueError('SYNTHETIC_SETTINGS_OR_VAULT_ROLLBACK_FAILED')
    return {'status': 'PROTECTED_BIND_PROTOCOL_PASS', 'quotingVectors': len(values), 'trueExtendedBind': True, 'vaultCreatesRolledBack': 2, 'statementLoggingRetained': True, 'errorLoggingRetained': True, 'parameterValuesInServerLogs': False, 'parameterValuesInClientOutput': False, 'persistentLoggingSettingsChanged': False, 'expectedErrorSqlstate': '22012', 'realCredentialOrProviderUsed': False, 'productionAccess': False}
