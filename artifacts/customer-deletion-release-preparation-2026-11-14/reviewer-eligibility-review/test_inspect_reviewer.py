import copy
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import types
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('reviewer', ROOT / 'inspect_reviewer.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SENTINEL = 'PRIVATE_CONTACT_TOKEN_PASSWORD_MUST_NOT_ESCAPE'


def facts():
    value = {k: True for k in m.BOOLEANS}
    value.update(dict.fromkeys(m.COUNTS, 1))
    value.update(checkoutPolicy='standard', privilegedWorkConflict=False, customerScopeConflict=False,
                 pendingShopInvitationForEmail=False, futureSlotVerified=False, fullDeletionEligibilityVerified=False)
    return value


class ReviewerTests(unittest.TestCase):
    def test_fixed_embedded_sql_matches_reviewed_file(self):
        self.assertEqual(m.SQL, (ROOT / 'lookup.sql').read_text())
        self.assertEqual(hashlib.sha256(m.SQL.encode()).hexdigest(), m.SQL_SHA256)

    def test_read_only_transaction_metacommands_and_no_mutation_tokens(self):
        stripped = re.sub(r"'(?:''|[^'])*'", "''", m.SQL)
        self.assertIn('begin isolation level repeatable read read only;', stripped)
        self.assertTrue(stripped.rstrip().endswith('rollback;'))
        self.assertNotRegex(stripped, r'(?i)\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze)\b')
        commands = [line.strip() for line in stripped.splitlines() if line.startswith('\\')]
        self.assertEqual(commands, ['\\set ON_ERROR_STOP on', '\\gset', '\\if :schema_ok', '\\else', '\\endif'])
        self.assertIn("set local statement_timeout = '8s'", m.SQL)
        self.assertIn("set local lock_timeout = '1s'", m.SQL)

    def test_sql_parentheses_and_single_quotes_balanced_static_only(self):
        stripped = re.sub(r"'(?:''|[^'])*'", "''", m.SQL)
        balance = 0
        for c in stripped:
            if c == '(': balance += 1
            elif c == ')': balance -= 1
            self.assertGreaterEqual(balance, 0)
        self.assertEqual(balance, 0)
        self.assertEqual(stripped.count("'"), 2 * len(re.findall(r"'(?:''|[^'])*'", m.SQL)))

    def test_fixed_literals_no_deletion_booking_functions_or_booking_rows(self):
        self.assertEqual(m.SQL.count("lower(email)='support@barberplusplus.com'"), 3)
        for name in ('Atlas Grooming — Sharq (Demo)', 'Kareem Shah', 'Beard trim'):
            self.assertEqual(m.SQL.count(name), 1)
        for forbidden in ('public.bookings', 'auth.sessions', 'customer_deletion_service', 'deletion_actor(', 'customer_booking(', 'configure_', 'net.http', 'pg_read_file', 'customer_apple_', 'vault.'):
            self.assertNotIn(forbidden, m.SQL)
        self.assertIn('select distinct a.customer_id', m.SQL)
        self.assertIn('price=3.000', m.SQL); self.assertIn('duration=15', m.SQL)
        self.assertNotIn('select *', m.SQL.lower())

    def test_builtin_function_allowlist_static_only(self):
        stripped = re.sub(r"'(?:''|[^'])*'", "''", m.SQL)
        functions = set(re.findall(r'\b([a-z_][a-z0-9_.]*)\s*\(', stripped))
        functions -= {'when','or','then','as','and','select','where'}
        allowed = {'required', 'values', 'current_setting', 'to_regprocedure', 'exists', 'to_regtype', 'in',
                   'lower','coalesce','jsonb_typeof','jsonb_each','nullif','jsonb_array_elements','pg_input_is_valid',
                   'least','greatest','jsonb_build_object','count','bool_and','length','now','any','materialized'}
        self.assertFalse(functions - allowed, functions - allowed)

    def test_required_main_public_columns_exist_in_cached_main_schema(self):
        schema = subprocess.check_output(['git','show','origin/main:supabase/schema.expected.sql'],text=True)
        required = json.loads((ROOT/'required-schema.json').read_text())
        for name, columns in required.items():
            if not name.startswith('public.'): continue
            table=name.split('.')[1]; marker='CREATE TABLE IF NOT EXISTS "public"."'+table+'" ('
            block=schema.split(marker,1)[1].split('\n);',1)[0]
            available=set(re.findall(r'^\s+"([^"]+)"\s',block,re.M))
            self.assertFalse(set(columns)-available)
        self.assertNotIn('account_deleted_at',required['public.customers'])
        self.assertNotIn('private.customer_deletion_jobs',required)

    def test_schema_unknown_stops_without_facts(self):
        self.assertEqual(m.project({'schemaAvailable':False}),{'status':'STOP_SCHEMA_UNAVAILABLE','schemaAvailable':False})
        with self.assertRaises(ValueError):m.project({'schemaAvailable':0})

    def test_clean_unused_email_capture_does_not_authorize_creation(self):
        value=facts()
        for k in ('authMatchCount','customerEmailMatchCount','canonicalCustomerCount'):value[k]=0
        for k in ('emailConfirmed','passwordAvailable','authEnabled','trustedRoleIsCustomer','customerProfileActive'):value[k]=False
        result=m.project(value)
        self.assertEqual(result['status'],'CAPTURED_REVIEW_REQUIRED'); self.assertFalse(result['provisioningOrReuseAuthorized'])

    def test_existing_customer_capture_and_both_policies(self):
        for policy in ('standard','email_only'):
            result=m.project({**facts(),'checkoutPolicy':policy})
            self.assertEqual(result['status'],'CAPTURED_REVIEW_REQUIRED')
            self.assertFalse(result['facts']['fullDeletionEligibilityVerified'])
            self.assertFalse(result['facts']['futureSlotVerified'])

    def test_ambiguous_customer_auth_canonical_and_demo_counts_stop(self):
        for name in ('authMatchCount','customerEmailMatchCount','canonicalCustomerCount'):
            self.assertEqual(m.project({**facts(),name:2})['status'],'STOP_AMBIGUOUS_IDENTITY')
        for name in ('shopMatchCount','barberMatchCount','serviceMatchCount'):
            for count in (0,2):self.assertEqual(m.project({**facts(),name:count})['status'],'STOP_DEMO_MISSING_OR_AMBIGUOUS')

    def test_conflicts_and_pending_invite_stop(self):
        for name in ('privilegedWorkConflict','customerScopeConflict','pendingShopInvitationForEmail'):
            self.assertEqual(m.project({**facts(),name:True})['status'],'STOP_REVIEWER_IDENTITY_CONFLICT')

    def test_unknown_policy_or_schedule_and_inactive_demo_stop(self):
        self.assertEqual(m.project({**facts(),'checkoutPolicy':None})['status'],'STOP_CHECKOUT_POLICY_UNAVAILABLE')
        self.assertEqual(m.project({**facts(),'scheduleDataRecognized':False})['status'],'STOP_SCHEDULE_DATA_UNKNOWN')
        for key in m.DEMO_READY:self.assertEqual(m.project({**facts(),key:False})['status'],'STOP_DEMO_NOT_ELIGIBLE')

    def test_existing_login_not_ready_or_unmatched_customer_stops(self):
        for name in ('emailConfirmed','authEnabled','trustedRoleIsCustomer','passwordAvailable'):
            self.assertEqual(m.project({**facts(),name:False})['status'],'STOP_EXISTING_REVIEWER_LOGIN_NOT_READY')
        self.assertEqual(m.project({**facts(),'authMatchCount':0})['status'],'STOP_EXISTING_CUSTOMER_WITHOUT_MATCHING_LOGIN')

    def test_no_leak_additional_fields_nested_strings_and_types_refused(self):
        values=[{**facts(),'email':SENTINEL},{**facts(),'passwordAvailable':SENTINEL},
                {**facts(),'authMatchCount':True},{**facts(),'checkoutPolicy':SENTINEL},
                {**facts(),'emailConfirmed':{'token':SENTINEL}},{**facts(),'futureSlotVerified':True}]
        for value in values:
            with self.assertRaises(ValueError)as error:m.project(value)
            self.assertNotIn(SENTINEL,str(error.exception))

    def test_duplicate_keys_and_oversize_or_multiple_json_refused(self):
        for value in (b'{"schemaAvailable":false,"schemaAvailable":true}',b'x'*(m.MAX_OUTPUT+1),b'{}\n{}'):
            with self.assertRaises((ValueError,json.JSONDecodeError)):m.decode(value)

    def test_activation_bound_deadlines_not_reset_and_command_capped(self):
        a=1794644000;env=dict(zip(('BARBER_REVIEW_ACTIVATED_UTC','BARBER_REVIEW_STOP_UTC','BARBER_REVIEW_HARD_UTC'),map(str,(a,a+2700,a+3600))))
        self.assertEqual(m.deadlines(env,a+1),(a+2700,a+3600))
        for now in (a-1,a+2700,a+3600):
            with self.assertRaises(ValueError):m.deadlines(env,now)
        with self.assertRaises(ValueError):m.deadlines({**env,'BARBER_REVIEW_HARD_UTC':str(a+7200)},a+1)
        fake=Mock(return_value=types.SimpleNamespace(returncode=0,stdout=b'{}'))
        with patch.object(m.time,'time',return_value=a+2698),patch.object(m.subprocess,'run',fake):
            m.run(['synthetic'],None,a+2700);self.assertEqual(fake.call_args.kwargs['timeout'],2)
        with patch.object(m.time,'time',return_value=a+2700),patch.object(m.subprocess,'run',fake):
            with self.assertRaises(ValueError):m.run(['synthetic'],None,a+2700)

    def test_stderr_never_forwarded_and_bad_output_stops(self):
        fake=Mock(return_value=types.SimpleNamespace(returncode=1,stdout=SENTINEL.encode()))
        with patch.object(m.time,'time',return_value=1000),patch.object(m.subprocess,'run',fake):
            with self.assertRaises(ValueError)as error:m.run(['synthetic'],None,1100)
            self.assertNotIn(SENTINEL,str(error.exception));self.assertEqual(fake.call_args.kwargs['stderr'],subprocess.DEVNULL)

    def test_fixed_target_guard_prevents_production_io_in_local_tests(self):
        with patch.object(m.os,'geteuid',return_value=1),patch.object(m.os,'open')as opener,patch.object(m,'run')as runner:
            with self.assertRaises(ValueError):m.inspect()
            opener.assert_not_called();runner.assert_not_called()


if __name__=='__main__':unittest.main()
