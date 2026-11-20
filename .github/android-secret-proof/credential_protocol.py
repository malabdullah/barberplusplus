"""Credential-free source for one fixed protected-stdin installation proposal.

Only protocol construction/validation here. No key access, entropy, SQL/network
execution, files, logging configuration or service activation occurs on import.
"""
import base64, json, re

PROJECT = 'barber-plus-plus-phone-prod'
SENDER = 'barber-android-sender@barber-plus-plus-phone-prod.iam.gserviceaccount.com'
NAMES = ('customer_android_live_fcm', 'customer_android_live_dispatch_secret')
MAX_INPUT = 65536

def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('INVALID_CREDENTIAL_ENVELOPE')
        result[key] = value
    return result

def envelope(raw):
    if not isinstance(raw, bytes) or not 1 <= len(raw) <= MAX_INPUT:
        raise ValueError('INVALID_CREDENTIAL_ENVELOPE')
    data = json.loads(raw, object_pairs_hook=reject_duplicates)
    if not isinstance(data, dict) or set(data) != {'fcm', 'wakeSecret'}:
        raise ValueError('INVALID_CREDENTIAL_ENVELOPE')
    fcm = data['fcm']
    required = {'type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri', 'auth_provider_x509_cert_url', 'client_x509_cert_url'}
    if not isinstance(fcm, dict) or not required <= set(fcm) <= required | {'universe_domain'} or any(not isinstance(x, str) or '\x00' in x for x in fcm.values()):
        raise ValueError('INVALID_FCM_CREDENTIAL')
    exact = {'type': 'service_account', 'project_id': PROJECT, 'client_email': SENDER, 'auth_uri': 'https://accounts.google.com/o/oauth2/auth', 'token_uri': 'https://oauth2.googleapis.com/token', 'auth_provider_x509_cert_url': 'https://www.googleapis.com/oauth2/v1/certs', 'client_x509_cert_url': 'https://www.googleapis.com/robot/v1/metadata/x509/barber-android-sender%40barber-plus-plus-phone-prod.iam.gserviceaccount.com'}
    if any(fcm.get(k) != v for k, v in exact.items()) or fcm.get('universe_domain', 'googleapis.com') != 'googleapis.com':
        raise ValueError('WRONG_FCM_IDENTITY')
    if not re.fullmatch('[a-f0-9]{40}', fcm['private_key_id']) or not re.fullmatch('[0-9]{6,32}', fcm['client_id']):
        raise ValueError('INVALID_FCM_CREDENTIAL')
    if not re.fullmatch(r'-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PRIVATE KEY-----\n?', fcm['private_key']) or len(fcm['private_key']) > 8192:
        raise ValueError('INVALID_FCM_CREDENTIAL')
    if not isinstance(data['wakeSecret'], str) or not re.fullmatch('[a-f0-9]{64}', data['wakeSecret']):
        raise ValueError('INVALID_WAKE_SECRET')
    return json.dumps(fcm, sort_keys=True, separators=(',', ':'), ensure_ascii=True), data['wakeSecret']

def encoded_parameter(value):
    # Base64 has no quote, backslash, colon, backtick or line break. Psql meta
    # command quoting cannot interpret the original credential as input/code.
    result = base64.b64encode(value.encode('utf-8')).decode('ascii')
    if not re.fullmatch('[A-Za-z0-9+/]*={0,2}', result):
        raise ValueError('UNSAFE_PARAMETER_ENCODING')
    return result

def bind_one(value):
    return "\\bind '" + encoded_parameter(value) + "' \\g\n"

def bind_credentials(fcm, wake):
    if not re.fullmatch('[a-f0-9]{64}', wake):
        raise ValueError('INVALID_WAKE_SECRET')
    return "\\bind '" + encoded_parameter(fcm) + "' '" + wake + "' \\g\n"

PARAMETER_REDACTION = """set local log_parameter_max_length=0;
set local log_parameter_max_length_on_error=0;
do $redact$begin
 if current_setting('pgaudit.log_parameter',true)is not null then
  perform set_config('pgaudit.log_parameter','off',true);
 end if;
 if current_setting('log_parameter_max_length')<>'0'
 or current_setting('log_parameter_max_length_on_error')<>'0'
 or coalesce(current_setting('pgaudit.log_parameter',true),'off')<>'off'
 then raise exception using errcode='P0001',message='PARAMETER_REDACTION_REQUIRED';end if;
 if current_setting('auto_explain.log_min_duration',true)is not null
 and current_setting('auto_explain.log_min_duration')<>'-1'
 then raise exception using errcode='P0001',message='UNREVIEWED_PARAMETER_LOGGER';end if;
end $redact$;
"""

CREATE = """with f as materialized(
 select vault.create_secret(convert_from(decode($1,'base64'),'UTF8'),
 'customer_android_live_fcm','Dedicated Android FCM send-only credential')id
),w as materialized(
 select vault.create_secret($2::text,'customer_android_live_dispatch_secret',
 'Dedicated Android scheduled wake authentication')id
)
select case when f.id is not null and w.id is not null then 'CREATED_TWO'else 'INVALID_CREATE'end from f,w
"""

VERIFY = """select json_build_object(
 'fcmMatches',coalesce((select decrypted_secret=convert_from(decode($1,'base64'),'UTF8')from vault.decrypted_secrets where name='customer_android_live_fcm'),false),
 'wakeMatches',coalesce((select decrypted_secret=$2::text from vault.decrypted_secrets where name='customer_android_live_dispatch_secret'),false),
 'exactNamesPresent',(select count(*)=2 from vault.secrets where name in('customer_android_live_fcm','customer_android_live_dispatch_secret')))checks
"""

def credential_statements(fcm, wake):
    # SQL contains placeholders only; values occur solely in the private psql
    # meta-command stream and are sent via PostgreSQL extended Bind messages.
    verified = "with verified as (" + VERIFY + ")select 1/(((checks->>'fcmMatches')::boolean and(checks->>'wakeMatches')::boolean and(checks->>'exactNamesPresent')::boolean)::integer)=1 from verified\n"
    return CREATE + bind_credentials(fcm, wake) + verified + bind_credentials(fcm, wake)

def safe_sqlstate(stderr):
    match = re.search(rb'ERROR:\s+([0-9A-Z]{5})(?:\s|$)', stderr)
    return match.group(1).decode('ascii') if match else None
