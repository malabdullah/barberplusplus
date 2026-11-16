#!/usr/bin/env python3
"""Render our transaction-only pgTAP suite without installing extensions on Test.

Only the known assertion forms below are accepted. No database connection,
credentials, account seed or execution is performed by this renderer.
"""
import json
import pathlib
import re
import sys


def split_top(text, separator):
    result, start, depth, quote, pos = [], 0, 0, None, 0
    while pos < len(text):
        if quote:
            if text.startswith(quote, pos):
                if quote in ("'", '"') and text.startswith(quote * 2, pos):
                    pos += 2
                    continue
                pos += len(quote)
                quote = None
                continue
            pos += 1
            continue
        if text[pos] in ("'", '"'):
            quote = text[pos]
        elif text.startswith('$$', pos):
            quote = '$$'
            pos += 2
            continue
        elif text[pos] == '(':
            depth += 1
        elif text[pos] == ')':
            depth -= 1
        elif text[pos] == separator and depth == 0:
            result.append(text[start:pos].strip())
            start = pos + 1
        pos += 1
    if quote or depth:
        raise ValueError('Unbalanced SQL')
    if text[start:].strip():
        result.append(text[start:].strip())
    return result


def render(source, fixture_prefix='ad640000'):
    if fixture_prefix not in ('ad640000', 'ad650000'):
        raise ValueError('Unknown fixture prefix')
    source = re.sub(r'^--[^\n]*', '', source, flags=re.M)
    statements = split_top(source, ';')
    body, count = [], 0
    for statement in statements:
        if statement in ('begin', 'rollback', 'select no_plan()', 'create extension if not exists pgtap with schema extensions') or re.fullmatch(r'select\s+\*\s*from\s+finish\(\)', statement) or statement.startswith('set local search_path='):
            continue
        match = re.fullmatch(r'select (ok|is|throws_ok|lives_ok)\((.*)\)', statement, re.S)
        if not match:
            if statement.startswith('select '):
                statement = 'perform ' + statement[7:]
            if not statement.startswith(('perform ', 'insert into auth.', 'update auth.', 'update private.customer_native_email_requests ', 'insert into public.customers', 'insert into private.customer_accounts', 'delete from auth.sessions where id=')):
                raise ValueError('Unsupported SQL statement')
            body.append(statement + ';')
            continue
        kind, raw = match.groups()
        args = split_top(raw, ',')
        count += 1
        message = f'NATIVE_AUTH_CHECK_{count}_FAILED'
        if kind in ('ok', 'is'):
            condition = args[0] if kind == 'ok' else f'({args[0]}) is not distinct from ({args[1]})'
            body.append(f"if ({condition}) is distinct from true then raise exception '{message}';end if;")
        else:
            if not args[0].startswith('$$') or not args[0].endswith('$$'):
                raise ValueError('Assertion SQL must be literal')
            sql = args[0][2:-2]
            if not sql.startswith('select '):
                raise ValueError('Only protocol calls are expected')
            sql = 'perform ' + sql[7:] + ';'
            if kind == 'lives_ok':
                body.append(sql)
            else:
                expected_code, expected_message = args[1:3]
                body.append(f"rejected:=false;begin {sql} exception when others then if sqlstate is distinct from {expected_code} or sqlerrm is distinct from {expected_message} then raise;end if;rejected:=true;end;if not rejected then raise exception '{message}';end if;")
    sql = "begin;do $nativechecks$declare rejected boolean;begin\n" + '\n'.join(body) + "\nend$nativechecks$;rollback;\n"
    sql += f"select {count} as passed_checks, not exists(select 1 from auth.users where id in('{fixture_prefix}-0000-4000-8000-000000000001','{fixture_prefix}-0000-4000-8000-000000000002')) as fixtures_rolled_back;\n"
    return {'checks': count, 'query': sql}


if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[2]
    if sys.argv[1:] not in ([], ['android-fcm']):
        raise SystemExit('Only the reviewed auth or android-fcm suites are supported')
    fcm = sys.argv[1:] == ['android-fcm']
    name = '065_android_fcm_transport.sql' if fcm else '064_android_native_auth_binding.sql'
    print(json.dumps(render((root / 'supabase/tests' / name).read_text(), 'ad650000' if fcm else 'ad640000')))
