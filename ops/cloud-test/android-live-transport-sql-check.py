#!/usr/bin/env python3
"""Render the same assertions for hosted Test without installing pgTAP."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
source = (root / 'supabase/tests/067_android_live_transport.sql').read_text()
for statement in [
 'create extension if not exists pgtap with schema extensions;\n',
 'set local search_path=extensions,public,pg_catalog;\n',
 'select plan(1);\n',
 "select pass('44 Android Live registry and queue assertions passed');\n",
 'select * from finish();\n',
]:
 if source.count(statement) != 1:
  raise RuntimeError('Unexpected test harness shape')
 source = source.replace(statement, '')
source += "select 'ANDROID_LIVE_TRANSPORT_PASS' as status, not exists(select 1 from auth.users where id in('ad670000-0000-4000-8000-000000000001','ad670000-0000-4000-8000-000000000002')) as fixtures_rolled_back;\n"
print(json.dumps({'checks': 44, 'query': source}))
