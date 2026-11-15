"""Preparation primitives only. No CLI, implicit signing/entropy or activation."""
import copy
import json
import os
import pathlib
import re

import apple_cleanup_renewal as renewal

FLAGS = ('CUSTOMER_ACCOUNT_DELETION_ENABLED', 'CUSTOMER_ACCOUNT_DELETION_CLEANUP_ENABLED', 'CUSTOMER_APPLE_REVOCATION_ENABLED')
STAGE_NAMES = ('original.override.json', 'staged.override.json', 'encryption-v1', 'scope.json')


def prepare(document, config, now, *, issue, validate, entropy):
    """Dependencies must be deliberately supplied by the future approved runner."""
    renewal.validate_config(config)
    env = document['services']['functions']['environment']
    expected = {'APP_ENV': 'production', 'APP_URL': 'https://www.barberplusplus.com',
                'SUPABASE_URL': 'http://api-gw:8000', 'CUSTOMER_PUBLIC_API_URL': 'https://srv1073968.hstgr.cloud'}
    if not isinstance(env, dict) or any(env.get(k) != v for k, v in expected.items()):
        raise ValueError('BOOTSTRAP_DEPLOYMENT_DRIFT')
    if any(k in env for k in (renewal.PAIR, renewal.ENCRYPTION)):
        raise ValueError('EXISTING_CREDENTIAL_REQUIRES_REVIEW')
    if any(env.get(k, 'false') != 'false' for k in FLAGS) or env.get('CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', 'http://api-gw:8000') != 'http://api-gw:8000':
        raise ValueError('BOOTSTRAP_ACTIVATION_OR_BINDING_DRIFT')
    # Complete both validated signatures before requesting any encryption bytes.
    pair = {}
    metadata = {}
    for platform, client in renewal.CLIENTS.items():
        token = issue({**config, 'clientId': client}, now)
        claims = validate(token, {**config, 'clientId': client}, now)
        if claims.get('iat') != now or claims.get('exp') != now + renewal.signing.LIFETIME:
            raise ValueError('UNEXPECTED_INITIAL_CREDENTIAL_LIFETIME')
        pair[platform] = {'clientId': client, 'clientSecret': token}
        metadata[platform] = {'issuedAt': now, 'expiresAt': claims['exp']}
    key = entropy(32)
    if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{64}', key):
        raise ValueError('INVALID_INITIAL_ENCRYPTION_MATERIAL')
    changed = renewal.replace_pair(document, pair)
    target = changed['services']['functions']['environment']
    target[renewal.ENCRYPTION] = key
    target['CUSTOMER_ACCOUNT_DELETION_BACKEND_URL'] = 'http://api-gw:8000'
    for flag in FLAGS:
        target[flag] = 'false'
    allowed = {renewal.PAIR, renewal.ENCRYPTION, 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL', *FLAGS}
    restored = copy.deepcopy(changed)
    for name in allowed:
        restored['services']['functions']['environment'].pop(name, None)
    original = copy.deepcopy(document)
    for name in allowed:
        original['services']['functions']['environment'].pop(name, None)
    if restored != original:
        raise ValueError('BOOTSTRAP_UNRELATED_CHANGE')
    return changed, key, renewal.summary(metadata, now, 'INITIAL_PAIR_PREPARED_DEFAULT_OFF')


def stage(config, original_raw, now, *, issue, validate, entropy):
    """Write only a new private staging directory; never replace live configuration.

    Caller must hold the existing backend lock and verify actual runtime/model.
    A pre-existing/partial staging directory is never reused or removed here.
    """
    renewal.validate_config(config)
    parent = pathlib.Path(config['stateDirectory']).parent
    renewal.private_directory(parent)
    directory = parent / 'bootstrap'
    if directory.exists() or directory.is_symlink():
        raise ValueError('EXISTING_BOOTSTRAP_REQUIRES_REVIEW')
    document, key, report = prepare(json.loads(original_raw), config, now, issue=issue, validate=validate, entropy=entropy)
    candidate = json.dumps(document, indent=2).encode()
    scope = {'status': 'STAGED_DEFAULT_OFF_NOT_INSTALLED', 'createdAt': renewal.signing.stamp(now),
             'configurationSha256': renewal.signing.sha(json.dumps(config, sort_keys=True).encode()),
             'beforeSha256': renewal.signing.sha(original_raw), 'candidateSha256': renewal.signing.sha(candidate),
             'encryptionKeySha256': renewal.signing.sha(key.encode()), 'ownedNames': list(STAGE_NAMES), 'expiry': report}
    # Partial writes remain private and block retries; never silently regenerate.
    directory.mkdir(mode=0o700)
    renewal.signing.atomic(directory / 'original.override.json', original_raw)
    renewal.signing.atomic(directory / 'staged.override.json', candidate)
    renewal.signing.atomic(directory / 'encryption-v1', key.encode())
    renewal.signing.record(directory / 'scope.json', scope)
    return report
