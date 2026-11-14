#!/usr/bin/env python3
"""PROPOSED single fixed read-only lookup. No production execution authorized."""
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time

SQL = '\\set ON_ERROR_STOP on\nbegin isolation level repeatable read read only;\nset local search_path = pg_catalog;\nset local statement_timeout = \'8s\';\nset local lock_timeout = \'1s\';\nset local idle_in_transaction_session_timeout = \'12s\';\nwith required(s,r,c,t) as (values\n(\'auth\',\'users\',\'id\',\'uuid\'),\n(\'auth\',\'users\',\'email\',\'character varying\'),\n(\'auth\',\'users\',\'email_confirmed_at\',\'timestamp with time zone\'),\n(\'auth\',\'users\',\'encrypted_password\',\'character varying\'),\n(\'auth\',\'users\',\'raw_app_meta_data\',\'jsonb\'),\n(\'auth\',\'users\',\'banned_until\',\'timestamp with time zone\'),\n(\'auth\',\'users\',\'deleted_at\',\'timestamp with time zone\'),\n(\'auth\',\'identities\',\'user_id\',\'uuid\'),\n(\'auth\',\'identities\',\'provider\',\'text\'),\n(\'public\',\'customers\',\'id\',\'uuid\'),\n(\'public\',\'customers\',\'email\',\'character varying\'),\n(\'public\',\'customers\',\'status\',\'character varying\'),\n(\'private\',\'customer_accounts\',\'user_id\',\'uuid\'),\n(\'private\',\'customer_accounts\',\'customer_id\',\'uuid\'),\n(\'private\',\'customer_social_identities\',\'user_id\',\'uuid\'),\n(\'private\',\'customer_social_identities\',\'account_user_id\',\'uuid\'),\n(\'public\',\'branches\',\'id\',\'uuid\'),\n(\'public\',\'branches\',\'manager_id\',\'uuid\'),\n(\'public\',\'branches\',\'name\',\'text\'),\n(\'public\',\'branches\',\'status\',\'text\'),\n(\'public\',\'branches\',\'publication_state\',\'text\'),\n(\'public\',\'branches\',\'working_hours\',\'jsonb\'),\n(\'public\',\'barbers\',\'id\',\'uuid\'),\n(\'public\',\'barbers\',\'user_id\',\'uuid\'),\n(\'public\',\'barbers\',\'branch_id\',\'uuid\'),\n(\'public\',\'barbers\',\'name\',\'text\'),\n(\'public\',\'barbers\',\'status\',\'text\'),\n(\'public\',\'barbers\',\'service_ids\',\'uuid[]\'),\n(\'public\',\'barbers\',\'availability\',\'jsonb\'),\n(\'public\',\'barbers\',\'time_offs\',\'jsonb\'),\n(\'public\',\'barbers\',\'vacations\',\'jsonb\'),\n(\'public\',\'barbers\',\'availability_approved_at\',\'timestamp with time zone\'),\n(\'public\',\'barbers\',\'invite_status\',\'character varying\'),\n(\'public\',\'barbers\',\'manager_chair\',\'boolean\'),\n(\'public\',\'barbers\',\'management_mode\',\'text\'),\n(\'public\',\'barbers\',\'max_booking_days\',\'integer\'),\n(\'public\',\'services\',\'id\',\'uuid\'),\n(\'public\',\'services\',\'branch_id\',\'uuid\'),\n(\'public\',\'services\',\'name\',\'text\'),\n(\'public\',\'services\',\'status\',\'text\'),\n(\'public\',\'services\',\'duration\',\'integer\'),\n(\'public\',\'services\',\'price\',\'numeric\'),\n(\'public\',\'audit_logs\',\'admin_user_id\',\'uuid\'),\n(\'private\',\'shop_barber_invitations\',\'manager_id\',\'uuid\'),\n(\'private\',\'shop_barber_invitations\',\'accepted_user_id\',\'uuid\'),\n(\'private\',\'shop_barber_invitations\',\'email\',\'text\'),\n(\'private\',\'shop_barber_invitations\',\'status\',\'text\'),\n(\'private\',\'customer_checkout_runtime\',\'singleton\',\'boolean\'),\n(\'private\',\'customer_checkout_runtime\',\'policy\',\'text\')\n)\nselect (current_setting(\'server_version_num\')::integer between 170000 and 179999\n and to_regprocedure(\'pg_catalog.pg_input_is_valid(text,text)\') is not null\n and not exists(\n select 1 from required x\n left join pg_namespace ns on ns.nspname=x.s\n left join pg_class cl on cl.relnamespace=ns.oid and cl.relname=x.r and cl.relkind=\'r\'\n left join pg_attribute a on a.attrelid=cl.oid and a.attname=x.c and a.attnum>0 and not a.attisdropped\n where a.atttypid is distinct from to_regtype(x.t))) as schema_ok\n\\gset\n\\if :schema_ok\nwith\ntarget_auth as materialized (\n select id,email_confirmed_at,encrypted_password,raw_app_meta_data,banned_until,deleted_at\n from auth.users where lower(email)=\'support@barberplusplus.com\'\n), primary_owners as materialized (\n select distinct coalesce(x.account_user_id,u.id) as id from target_auth u\n left join private.customer_social_identities x on x.user_id=u.id\n), people as materialized (\n select u.id,u.raw_app_meta_data,u.banned_until,u.deleted_at from auth.users u\n where u.id in(select id from target_auth) or u.id in(select id from primary_owners)\n or u.id in(select x.user_id from private.customer_social_identities x where x.account_user_id in(select id from primary_owners))\n), email_customers as materialized (\n select id,status from public.customers where lower(email)=\'support@barberplusplus.com\'\n), owned_customers as materialized (\n select distinct a.customer_id from private.customer_accounts a where a.user_id in(select id from people)\n), shop as materialized (\n select id,manager_id,status,publication_state,working_hours from public.branches\n where name=\'Atlas Grooming — Sharq (Demo)\'\n), barber as materialized (\n select b.id,b.user_id,b.branch_id,b.status,b.service_ids,b.availability,b.time_offs,b.vacations,\n b.availability_approved_at,b.invite_status,b.manager_chair,b.management_mode,b.max_booking_days\n from public.barbers b join shop s on s.id=b.branch_id where b.name=\'Kareem Shah\'\n), service as materialized (\n select v.id,v.branch_id,v.status,v.duration,v.price from public.services v\n join shop s on s.id=v.branch_id where v.name=\'Beard trim\'\n), schedule as materialized (\n select\n (jsonb_typeof(s.working_hours)=\'object\' and jsonb_typeof(b.availability)=\'object\'\n and jsonb_typeof(b.time_offs)=\'array\' and jsonb_typeof(b.vacations)=\'array\'\n and not exists(select 1 from jsonb_each(case when jsonb_typeof(s.working_hours)=\'object\' then s.working_hours else \'{}\'::jsonb end) h\n   where not coalesce(h.key in(\'monday\',\'tuesday\',\'wednesday\',\'thursday\',\'friday\',\'saturday\',\'sunday\')\n   and jsonb_typeof(h.value)=\'object\'\n   and (nullif(h.value->>\'open\',\'\') is null or\n    (h.value->>\'open\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\' and h.value->>\'close\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\'\n     and h.value->>\'open\'<h.value->>\'close\')),false))\n and not exists(select 1 from jsonb_each(case when jsonb_typeof(b.availability)=\'object\' then b.availability else \'{}\'::jsonb end) h\n   where not coalesce(h.key in(\'monday\',\'tuesday\',\'wednesday\',\'thursday\',\'friday\',\'saturday\',\'sunday\')\n   and jsonb_typeof(h.value)=\'object\' and coalesce(h.value->>\'enabled\',h.value->>\'available\',\'false\') in(\'true\',\'false\')\n   and (coalesce(h.value->>\'enabled\',h.value->>\'available\',\'false\')=\'false\' or\n    (h.value->>\'start\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\' and h.value->>\'end\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\'\n     and h.value->>\'start\'<h.value->>\'end\')),false))\n and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.time_offs)=\'array\' then b.time_offs else \'[]\'::jsonb end) x\n   where not coalesce(jsonb_typeof(x)=\'object\'\n   and x->>\'start\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\' and x->>\'end\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\' and x->>\'start\'<x->>\'end\'\n   and ((x->>\'type\'=\'recurring\' and x->>\'day\' in(\'monday\',\'tuesday\',\'wednesday\',\'thursday\',\'friday\',\'saturday\',\'sunday\'))\n     or (x->>\'type\'=\'one-time\' and x->>\'date\' ~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\' and pg_input_is_valid(x->>\'date\',\'date\'))),false))\n and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.vacations)=\'array\' then b.vacations else \'[]\'::jsonb end) x\n   where not coalesce(jsonb_typeof(x)=\'object\' and x->>\'startDate\' ~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\'\n   and x->>\'endDate\' ~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\'\n   and pg_input_is_valid(x->>\'startDate\',\'date\') and pg_input_is_valid(x->>\'endDate\',\'date\')\n   and x->>\'startDate\'<=x->>\'endDate\',false))) as recognized,\n exists(select 1 from jsonb_each(case when jsonb_typeof(b.availability)=\'object\' then b.availability else \'{}\'::jsonb end) h\n   where h.key in(\'monday\',\'tuesday\',\'wednesday\',\'thursday\',\'friday\',\'saturday\',\'sunday\')\n   and case when coalesce(h.value->>\'enabled\',h.value->>\'available\',\'false\')=\'true\'\n     and h.value->>\'start\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\' and h.value->>\'end\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\'\n     and s.working_hours->h.key->>\'open\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\'\n     and s.working_hours->h.key->>\'close\' ~ \'^([01][0-9]|2[0-3]):[0-5][0-9]$\'\n     and h.value->>\'start\'<h.value->>\'end\' and s.working_hours->h.key->>\'open\'<s.working_hours->h.key->>\'close\'\n   then least(h.value->>\'end\',s.working_hours->h.key->>\'close\')::time\n     - greatest(h.value->>\'start\',s.working_hours->h.key->>\'open\')::time >= interval \'15 minutes\'\n   else false end) as regular_overlap\n from shop s join barber b on b.branch_id=s.id\n), policy as materialized (\n select policy from private.customer_checkout_runtime where singleton\n)\nselect jsonb_build_object(\n \'schemaAvailable\',true,\n \'authMatchCount\',(select count(*)from target_auth),\n \'customerEmailMatchCount\',(select count(*)from email_customers),\n \'canonicalCustomerCount\',(select count(*)from owned_customers),\n \'shopMatchCount\',(select count(*)from shop),\n \'barberMatchCount\',(select count(*)from barber),\n \'serviceMatchCount\',(select count(*)from service),\n \'emailConfirmed\',coalesce((select bool_and(email_confirmed_at is not null)from target_auth),false),\n \'passwordAvailable\',coalesce((select bool_and(length(encrypted_password)>0)from target_auth),false),\n \'authEnabled\',coalesce((select bool_and(deleted_at is null and (banned_until is null or banned_until<=now()))from people),false),\n \'trustedRoleIsCustomer\',coalesce((select bool_and(raw_app_meta_data->>\'role\'=\'customer\')from people),false),\n \'emailProviderAvailable\',exists(select 1 from auth.identities where user_id in(select id from people)and provider=\'email\'),\n \'googleProviderAvailable\',exists(select 1 from auth.identities where user_id in(select id from people)and provider=\'google\'),\n \'appleProviderAvailable\',exists(select 1 from auth.identities where user_id in(select id from people)and provider=\'apple\'),\n \'privilegedWorkConflict\',exists(select 1 from people where raw_app_meta_data->>\'role\' is distinct from \'customer\')\n   or exists(select 1 from public.barbers where user_id in(select id from people))\n   or exists(select 1 from public.branches where manager_id in(select id from people))\n   or exists(select 1 from public.audit_logs where admin_user_id in(select id from people))\n   or exists(select 1 from private.shop_barber_invitations where manager_id in(select id from people)or accepted_user_id in(select id from people)),\n \'customerScopeConflict\',exists(select 1 from private.customer_accounts where customer_id in(select customer_id from owned_customers)and user_id not in(select id from people))\n   or exists(select 1 from private.customer_accounts where customer_id in(select id from email_customers)and user_id not in(select id from people)),\n \'pendingShopInvitationForEmail\',exists(select 1 from private.shop_barber_invitations where lower(email)=\'support@barberplusplus.com\'and status=\'pending\'),\n \'customerProfileActive\',coalesce((select bool_and(status=\'active\')from public.customers where id in(select customer_id from owned_customers)),false),\n \'shopActive\',coalesce((select bool_and(status=\'active\')from shop),false),\n \'shopPublished\',coalesce((select bool_and(publication_state=\'published\')from shop),false),\n \'barberActive\',coalesce((select bool_and(status=\'active\')from barber),false),\n \'barberAccountEligible\',exists(select 1 from barber b join shop s on s.id=b.branch_id\n   where (b.management_mode=\'managed\'and b.user_id is null and not b.manager_chair)\n   or (b.management_mode=\'account\'and (b.invite_status is null or b.invite_status=\'accepted\'or b.manager_chair)\n     and exists(select 1 from auth.users u where u.id=b.user_id and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())\n       and ((b.manager_chair and u.id=s.manager_id and u.raw_app_meta_data->>\'role\'=\'manager\')\n        or(not b.manager_chair and u.raw_app_meta_data->>\'role\'=\'barber\'))))),\n \'serviceActive\',coalesce((select bool_and(status=\'active\')from service),false),\n \'serviceLinked\',exists(select 1 from service s join barber b on b.branch_id=s.branch_id where s.id=any(b.service_ids)),\n \'priceMatches\',coalesce((select bool_and(price=3.000)from service),false),\n \'durationMatches\',coalesce((select bool_and(duration=15)from service),false),\n \'scheduleDataRecognized\',coalesce((select bool_and(recognized)from schedule),false),\n \'scheduleApproved\',coalesce((select bool_and(availability_approved_at is not null)from barber),false),\n \'regularHoursCanFitService\',coalesce((select bool_and(regular_overlap)from schedule),false),\n \'maxBookingDaysValid\',coalesce((select bool_and(max_booking_days between 1 and 365)from barber),false),\n \'hasBreaks\',exists(select 1 from barber where time_offs<>\'[]\'::jsonb),\n \'hasVacations\',exists(select 1 from barber where vacations<>\'[]\'::jsonb),\n \'futureSlotVerified\',false,\n \'fullDeletionEligibilityVerified\',false,\n \'checkoutPolicy\',case when(select count(*)from policy)=1 then(select case when policy in(\'standard\',\'email_only\')then policy else null end from policy)else null end\n);\n\\else\nselect \'{"schemaAvailable":false}\'::jsonb;\n\\endif\nrollback;\n'
SQL_SHA256 = '44e7f2a5d66e7e7f9b7439b74a5e94eb59b2607d0e0bad0370d4028fe2eef65e'
LOCK = pathlib.Path('/var/lib/barber-release-backend/backend.lock')
DB_IMAGE = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
MAX_OUTPUT = 16384
COUNTS = ('authMatchCount', 'customerEmailMatchCount', 'canonicalCustomerCount', 'shopMatchCount', 'barberMatchCount', 'serviceMatchCount')
BOOLEANS = ('schemaAvailable', 'emailConfirmed', 'passwordAvailable', 'authEnabled', 'trustedRoleIsCustomer',
            'emailProviderAvailable', 'googleProviderAvailable', 'appleProviderAvailable', 'privilegedWorkConflict',
            'customerScopeConflict', 'pendingShopInvitationForEmail', 'customerProfileActive', 'shopActive',
            'shopPublished', 'barberActive', 'barberAccountEligible', 'serviceActive', 'serviceLinked', 'priceMatches',
            'durationMatches', 'scheduleDataRecognized', 'scheduleApproved', 'regularHoursCanFitService',
            'maxBookingDaysValid', 'hasBreaks', 'hasVacations', 'futureSlotVerified', 'fullDeletionEligibilityVerified')
DEMO_READY = ('shopActive', 'shopPublished', 'barberActive', 'barberAccountEligible', 'serviceActive', 'serviceLinked',
              'priceMatches', 'durationMatches', 'scheduleApproved', 'regularHoursCanFitService', 'maxBookingDaysValid')


def require(condition):
    if not condition:
        raise ValueError('FIXED_READ_ONLY_CHECK_STOPPED')


def deadlines(environment, now):
    names = ('BARBER_REVIEW_ACTIVATED_UTC', 'BARBER_REVIEW_STOP_UTC', 'BARBER_REVIEW_HARD_UTC')
    require(all(re.fullmatch('[0-9]{10}', environment.get(name, '')) for name in names))
    activation, stop, hard = (int(environment[name]) for name in names)
    require(stop == activation + 2700 and hard == activation + 3600 and activation <= now < stop)
    return stop, hard


def run(args, data, stop):
    remaining = stop - time.time()
    require(remaining > 0)
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=min(30, remaining), check=False)
    require(result.returncode == 0 and len(result.stdout) <= MAX_OUTPUT)
    return result.stdout


def decode(raw):
    require(isinstance(raw, bytes) and len(raw) <= MAX_OUTPUT)
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value)
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=unique)


def project(value):
    require(isinstance(value, dict))
    if set(value) == {'schemaAvailable'} and value['schemaAvailable'] is False:
        return {'status': 'STOP_SCHEMA_UNAVAILABLE', 'schemaAvailable': False}
    require(set(value) == set(COUNTS) | set(BOOLEANS) | {'checkoutPolicy'})
    require(all(type(value[k]) is int and 0 <= value[k] <= 1000000 for k in COUNTS))
    require(all(type(value[k]) is bool for k in BOOLEANS))
    require(value['schemaAvailable'] and value['futureSlotVerified'] is False and value['fullDeletionEligibilityVerified'] is False)
    require(value['checkoutPolicy'] in ('standard', 'email_only', None))
    status = 'CAPTURED_REVIEW_REQUIRED'
    if value['authMatchCount'] > 1 or value['customerEmailMatchCount'] > 1 or value['canonicalCustomerCount'] > 1:
        status = 'STOP_AMBIGUOUS_IDENTITY'
    elif any(value[k] != 1 for k in ('shopMatchCount', 'barberMatchCount', 'serviceMatchCount')):
        status = 'STOP_DEMO_MISSING_OR_AMBIGUOUS'
    elif value['checkoutPolicy'] is None:
        status = 'STOP_CHECKOUT_POLICY_UNAVAILABLE'
    elif value['privilegedWorkConflict'] or value['customerScopeConflict'] or value['pendingShopInvitationForEmail']:
        status = 'STOP_REVIEWER_IDENTITY_CONFLICT'
    elif value['authMatchCount'] == 0 and value['customerEmailMatchCount'] != 0:
        status = 'STOP_EXISTING_CUSTOMER_WITHOUT_MATCHING_LOGIN'
    elif not value['scheduleDataRecognized']:
        status = 'STOP_SCHEDULE_DATA_UNKNOWN'
    elif not all(value[k] for k in DEMO_READY):
        status = 'STOP_DEMO_NOT_ELIGIBLE'
    elif value['authMatchCount'] == 1 and not all(value[k] for k in ('emailConfirmed', 'authEnabled', 'trustedRoleIsCustomer', 'passwordAvailable')):
        status = 'STOP_EXISTING_REVIEWER_LOGIN_NOT_READY'
    return {'status': status, 'facts': value, 'writesAttempted': False, 'provisioningOrReuseAuthorized': False}


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def inspect():
    require(len(sys.argv) == 1 and os.geteuid() == 0 and os.uname().nodename.split('.')[0] == 'srv1073968')
    stop, hard = deadlines(os.environ, time.time())
    require(hashlib.sha256(SQL.encode()).hexdigest() == SQL_SHA256)
    parent = LOCK.parent.lstat()
    require(LOCK.parent.resolve() == LOCK.parent and stat.S_ISDIR(parent.st_mode)
            and parent.st_uid == 0 and stat.S_IMODE(parent.st_mode) == 0o700)
    descriptor = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        require(LOCK.resolve() == LOCK and stat.S_ISREG(info.st_mode) and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and info.st_size == 0)
        fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        require(fingerprint(info) == fingerprint(LOCK.lstat()))
        template = '{"image":{{json .Image}},"running":{{json .State.Running}},"healthy":{{if .State.Health}}{{eq .State.Health.Status "healthy"}}{{else}}false{{end}}}'
        runtime = decode(run(['docker', 'inspect', '--type', 'container', '--format', template, 'supabase-db'], None, stop))
        require(runtime == {'image': DB_IMAGE, 'running': True, 'healthy': True})
        raw = run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-w', '-qAt', '-P', 'pager=off',
                   '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], SQL.encode(), stop)
        result = project(decode(raw))
        require(fingerprint(info) == fingerprint(os.fstat(descriptor)) == fingerprint(LOCK.lstat())
                and fingerprint(parent) == fingerprint(LOCK.parent.lstat()) and time.time() < hard)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['status'] == 'CAPTURED_REVIEW_REQUIRED' else 2
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    try:
        raise SystemExit(inspect())
    except Exception:
        # No SQL/stderr/exception text, source values, identities or hashes escape.
        print(json.dumps({'status': 'STOP_READ_ONLY_LOOKUP_UNAVAILABLE', 'writesAttempted': False}))
        raise SystemExit(2)
