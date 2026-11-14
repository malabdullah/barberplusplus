"""Preparation only: one reviewed missing inherited pin, never active normalization.

No CLI, implicit signing, entropy, Docker calls or installation. The approved
runner must hold the existing backend lock and supply fresh on-server evidence.
"""
import copy
import json
import pathlib
import re

import apple_cleanup_bootstrap as bootstrap
import apple_cleanup_renewal as renewal

PIN = 'SUPABASE_URL'
VALUE = 'http://api-gw:8000'
PINS = {'APP_ENV': 'production', 'APP_URL': 'https://www.barberplusplus.com',
        PIN: VALUE, 'CUSTOMER_PUBLIC_API_URL': 'https://srv1073968.hstgr.cloud'}
ABSENT = (renewal.PAIR, renewal.ENCRYPTION, *bootstrap.FLAGS, 'CUSTOMER_ACCOUNT_DELETION_BACKEND_URL')
PROOF_FIELDS = {'sourceSha256', 'runtimeBindings', 'runtimeAbsentFields', 'functionsImageId',
                'functionsRunning', 'functionsHealthy', 'composeModelHash', 'runtimeComposeHash'}


def candidate_base(config, original_raw, evidence):
    """Validate original source + exact effective model before explicit dependency use."""
    renewal.validate_config(config)
    if (not isinstance(original_raw, bytes) or not original_raw or len(original_raw) > 1024 * 1024
            or not isinstance(evidence, dict) or set(evidence) != PROOF_FIELDS):
        raise ValueError('INHERITED_PIN_EVIDENCE')
    if evidence['sourceSha256'] != renewal.signing.sha(original_raw):
        raise ValueError('INHERITED_PIN_SOURCE_DRIFT')
    if (evidence['runtimeBindings'] != PINS
            or evidence['runtimeAbsentFields'] != sorted(ABSENT)
            or evidence['functionsImageId'] != config['imageIds']['supabase-edge-functions']
            or evidence['functionsRunning'] is not True or evidence['functionsHealthy'] is not True
            or not isinstance(evidence['composeModelHash'], str)
            or not re.fullmatch(r'[a-f0-9]{64}', evidence['composeModelHash'])
            or evidence['composeModelHash'] != evidence['runtimeComposeHash']):
        raise ValueError('INHERITED_PIN_RUNTIME_OR_MODEL_DRIFT')
    document = json.loads(original_raw)
    env = document['services']['functions']['environment']
    if not isinstance(env, dict) or PIN in env:
        # Present-empty/wrong/correct are all outside this missing-pin-only path.
        raise ValueError('INHERITED_PIN_MUST_BE_ABSENT')
    if any(name in env for name in ABSENT):
        raise ValueError('INHERITED_PIN_SOURCE_FIELDS_MUST_BE_ABSENT')
    if any(env.get(k) != v for k, v in PINS.items() if k != PIN):
        raise ValueError('INHERITED_PIN_OTHER_SOURCE_DRIFT')
    derived = copy.deepcopy(document)
    derived['services']['functions']['environment'][PIN] = VALUE
    return derived


def stage(config, original_raw, now, evidence, *, issue, validate, entropy):
    """Stage final candidate only; original.override.json is actual original bytes.

    Caller must verify fixed canonical config/paths, public sources, original login
    metadata, four healthy reviewed containers, runtime absent fields and exact
    current Compose hash under the lock. Evidence is not a saved receipt or an
    authorization token. Caller must recheck actual active source before install.
    """
    derived = candidate_base(config, original_raw, evidence)
    parent = pathlib.Path(config['stateDirectory']).parent
    renewal.private_directory(parent)
    directory = parent / 'bootstrap'
    if directory.exists() or directory.is_symlink():
        raise ValueError('EXISTING_BOOTSTRAP_REQUIRES_REVIEW')
    # The original strict bootstrap guards still execute before issue or entropy.
    document, key, report = bootstrap.prepare(derived, config, now, issue=issue, validate=validate, entropy=entropy)
    candidate = json.dumps(document, indent=2).encode()
    scope = {'status': 'STAGED_DEFAULT_OFF_NOT_INSTALLED', 'createdAt': renewal.signing.stamp(now),
             'configurationSha256': renewal.signing.sha(json.dumps(config, sort_keys=True).encode()),
             'beforeSha256': renewal.signing.sha(original_raw), 'candidateSha256': renewal.signing.sha(candidate),
             'encryptionKeySha256': renewal.signing.sha(key.encode()), 'ownedNames': list(bootstrap.STAGE_NAMES),
             'explicitInheritedPinAdded': PIN, 'expiry': report}
    directory.mkdir(mode=0o700)
    # Never call bootstrap.stage with a normalized serialization as original_raw.
    renewal.signing.atomic(directory / 'original.override.json', original_raw)
    renewal.signing.atomic(directory / 'staged.override.json', candidate)
    renewal.signing.atomic(directory / 'encryption-v1', key.encode())
    renewal.signing.record(directory / 'scope.json', scope)
    return report
