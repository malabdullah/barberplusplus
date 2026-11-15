import base64, copy, importlib.util, json, pathlib, re, types, unittest
P=pathlib.Path(__file__).with_name('inspect_metadata.py')
spec=importlib.util.spec_from_file_location('preflight',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1800000000
SENTINEL='PRIVATE_SENTINEL_NEVER_RETURN_THIS_VALUE'
def encoded(x):return base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
def jwt(**claims):return encoded({'alg':'ES256','kid':'SYNTHKEY01'})+'.'+encoded({'iss':'D49RFZQ6BT','sub':m.CLIENTS[0],'aud':'https://appleid.apple.com','iat':NOW-100,'exp':NOW+86400,**claims})+'.'+SENTINEL
class FakeHost:
    def __init__(self):
        self.calls=[];self.absent=set();self.relations=[{'schema':a,'name':b,'rls':True}for a,b in [('barber_release','migrations'),('barber_release','schema_state'),('cron','job'),('private','customer_deletion_jobs'),('private','customer_apple_credentials'),('private','customer_apple_tasks')]]
        self.ledger=copy.deepcopy(m.EXPECTED_MIGRATIONS[:m.BASE_COUNT])
        self.files={
            'renewal':{'environment':'production','teamId':'D49RFZQ6BT','keyId':'SYNTHKEY01','clientId':m.CLIENTS[0],'acceptedClientIds':list(m.CLIENTS),'keyFile':m.KEY_PATH,'stateDirectory':m.ROOT+'/apple-renewal/state','unrelated':SENTINEL},
            'renewalState':{'phase':'HEALTHY_NOT_DUE','checkedAt':m.stamp(NOW),'expiresAt':m.stamp(NOW+86400),'beforeRuntime':SENTINEL},
            'backend':{'enabled':True,'appUrl':m.PROD_APP,'stateDirectory':'/var/lib/barber-release-backend','backupEvidenceFile':m.JSON_FILES['backup'],'backupSystemId':'1234567890123456789','unrelatedCredential':SENTINEL},
            'backendState':{'phase':'FUNCTIONS_APPLIED','commit':'a'*40,'names':[SENTINEL]},
            'backup':{'policy':'daily-v1','provider':'b2','system_id':'1234567890123456789','captured_at':m.stamp(NOW-3600),'verified_at':m.stamp(NOW-3000),'base_backup':SENTINEL,'object_snapshot':SENTINEL,'recovery_lsn':SENTINEL,'repository':SENTINEL,'restore_seconds':300,**{k:True for k in ['encrypted_offsite','database_restored','storage_restored','functions_restored','configuration_restored','isolated_target_removed']}},
        }
    def runtime(self,n):self.calls.append(('runtime',n));return{'name':n,'running':True,'health':'healthy','imageId':m.EXPECTED_IMAGES[n],'matchesReviewedParent':True}
    def environment(self,n):
        self.calls.append(('environment',n))
        if n=='supabase-auth':return 'GOTRUE_EXTERNAL_APPLE_ENABLED=true\nGOTRUE_EXTERNAL_APPLE_CLIENT_ID='+','.join(m.CLIENTS)+'\nGOTRUE_EXTERNAL_APPLE_SECRET='+jwt()+'\nUNRELATED='+SENTINEL
        return 'APP_ENV=production\nAPP_URL='+m.PROD_APP+'\nSUPABASE_URL=http://api-gw:8000\nCUSTOMER_PUBLIC_API_URL='+m.PROD_API+'\nPRESENT:CUSTOMER_APPLE_ENCRYPTION_KEY=true\nPRESENT:RESEND_API_KEY=true\nCUSTOMER_APPLE_REVOCATION_CLIENTS='+json.dumps({'ios':{'clientId':m.CLIENTS[1],'clientSecret':jwt(sub=m.CLIENTS[1])},'web':{'clientId':m.CLIENTS[0],'clientSecret':jwt()},'unknown':{'clientSecret':SENTINEL}})
    def json_file(self,n):self.calls.append(('json_file',n));return None if n in self.absent else self.files[n]
    def key_stat(self,path):self.calls.append(('key_stat',path));return{'configuredReferenceAllowed':path==m.KEY_PATH,'present':True,'rootOwned':True,'privatePermissions':True}
    def code_hash(self,n):self.calls.append(('code_hash',n));return m.EXPECTED_CODE_HASHES[n]
    def timer(self,n):self.calls.append(('timer',n));return{'LoadState':'loaded','ActiveState':'active'}
    def sql(self,n):
        self.calls.append(('sql',n))
        if n=='catalogue':return{'serverVersion':'17.6 (distribution)','systemId':'1234567890123456789','relations':self.relations,'routineMetadata':[{'schema':'public','name':'customer_session_is_live','args':SENTINEL,'bodyHash':'c'*32,'securityDefiner':True,'anonymousExecute':False,'authenticatedExecute':False,'body':SENTINEL}]}
        if n=='ledger':return self.ledger
        if n=='fingerprint':return[{'fingerprint':'d'*64}]
        if n=='cron':return[{'name':'customer-deletion-cleanup','schedule':'* * * * *','active':True,'commandHash':'e'*32,'command':SENTINEL}]
        if n=='queue':return{'pending':0,'unscoped':0,'user_ids':SENTINEL}
        if n=='appleCounts':return{'credentials':0,'tasks':0,'cipher':SENTINEL}
        raise AssertionError(n)
class Tests(unittest.TestCase):
    def test_complete_projection_excludes_secrets_rows_paths_and_bodies(self):
        h=FakeHost();out=m.collect(h,NOW);text=json.dumps(out)
        for value in [SENTINEL,jwt(),'1234567890123456789',m.KEY_PATH]:self.assertNotIn(value,text)
        self.assertEqual(out['status'],'METADATA_CAPTURED_REVIEW_REQUIRED');self.assertTrue(out['ledger']['equalsReviewedMainPrefix']);self.assertEqual(len(out['ledger']['pendingCandidateNames']),9)
        self.assertTrue(out['backup']['b2DailyReceiptMetadataPass']);self.assertEqual(out['database']['serverVersion'],'17.6');self.assertFalse(out['limits']['privateKeyReadOrUsed']);self.assertFalse(out['limits']['frontendInspected'])
        self.assertEqual([x for x in h.calls if x[0]=='key_stat'],[('key_stat',m.KEY_PATH)])
    def test_jwt_unknown_claims_and_bad_tokens_do_not_escape(self):
        for raw in ['',SENTINEL,'a.b.c',jwt(iss=SENTINEL,sub=SENTINEL,aud=SENTINEL,exp=SENTINEL)]:self.assertNotIn(SENTINEL,json.dumps(m.jwt_metadata(raw,NOW)))
        result=m.jwt_metadata(jwt(),NOW);self.assertTrue(result['parseable']);self.assertFalse(result['signatureVerified']);self.assertEqual(result['keyId'],'SYNTHKEY01');self.assertFalse(result['expired'])
    def test_json_line_environment_handles_multiline_credential_json_without_leaking(self):
        raw=json.dumps('CUSTOMER_APPLE_REVOCATION_CLIENTS='+json.dumps({'web':{'clientId':m.CLIENTS[0],'clientSecret':jwt()}},indent=2))+'\n'+json.dumps('PRESENT:RESEND_API_KEY=true')
        out=m.summarize_environment(raw,NOW);self.assertTrue(out['appleCleanupCredentials']['parseable']);self.assertTrue(out['secretPresent']['RESEND_API_KEY']);self.assertNotIn(SENTINEL,json.dumps(out))
    def test_expiry_and_malformed_clock_metadata_are_explicit(self):
        self.assertTrue(m.jwt_metadata(jwt(exp=NOW-1),NOW)['expired'])
        for v in [True,'secret',float('nan'),-1,99999999999999]:self.assertIsNone(m.stamp(v))
    def test_only_known_env_values_and_client_ids_return(self):
        data=m.summarize_environment('SUPABASE_URL=https://'+SENTINEL+'@unexpected.invalid\nGOTRUE_EXTERNAL_APPLE_CLIENT_ID='+','.join(m.CLIENTS)+','+SENTINEL+'\nSUPABASE_SERVICE_ROLE_KEY='+SENTINEL,NOW)
        self.assertNotIn(SENTINEL,json.dumps(data));self.assertEqual(data['configuration']['SUPABASE_URL'],'unexpected');self.assertFalse(data['secretPresent']['SUPABASE_SERVICE_ROLE_KEY'])
    def test_environment_template_never_exports_unrelated_or_raw_encryption_keys(self):
        template=m.projection_template();self.assertNotIn('json .Config.Env',template);self.assertIn('PRESENT:%s',template)
        self.assertNotIn('openssl',P.read_text());self.assertNotIn('journalctl',P.read_text())
        self.assertEqual(m.METADATA_JWTS,('GOTRUE_EXTERNAL_APPLE_SECRET','CUSTOMER_APPLE_REVOCATION_CLIENTS'))
    def test_missing_deletion_tables_and_ledger_require_review_without_creation(self):
        h=FakeHost();h.relations=[];out=m.collect(h,NOW)
        self.assertFalse(out['ledger']['present']);self.assertIsNone(out['queue']);self.assertIsNone(out['appleStoreCounts']);self.assertIsNone(out['cron']);self.assertNotIn(('sql','ledger'),h.calls)
    def test_ledger_drift_extra_entries_and_bad_shape_do_not_pass(self):
        h=FakeHost();h.ledger[0]['sha256']='f'*64;self.assertFalse(m.collect(h,NOW)['ledger']['matchesCandidatePrefix'])
        h=FakeHost();h.ledger.append({'name':'20269999999999_unknown.sql','sha256':'f'*64});self.assertFalse(m.collect(h,NOW)['ledger']['matchesCandidatePrefix'])
        h=FakeHost();h.ledger=[{'name':SENTINEL,'sha256':SENTINEL}]
        with self.assertRaises(ValueError):m.collect(h,NOW)
    def test_backup_stale_future_mismatch_false_flags_or_transition_not_green(self):
        for changes in [{'captured_at':m.stamp(NOW-27*3600)},{'verified_at':m.stamp(NOW+1)},{'system_id':'other'},{'provider':'r2-transition'},{'configuration_restored':False},{'restore_seconds':0},{'repository':''}]:
            h=FakeHost();h.files['backup'].update(changes);self.assertFalse(m.collect(h,NOW)['backup']['b2DailyReceiptMetadataPass'])
    def test_optional_missing_private_files_dont_claim_ready(self):
        h=FakeHost();h.absent={'renewal','renewalState','backendState','backup'};out=m.collect(h,NOW);self.assertFalse(out['renewal']['configurationPresent']);self.assertFalse(out['backup']['receiptPresent']);self.assertFalse(out['backup']['b2DailyReceiptMetadataPass'])
    def test_cron_and_queue_output_are_fixed_safe_fields(self):
        h=FakeHost();original=h.sql
        def sql(n):
            if n=='cron':return[{'name':SENTINEL,'schedule':SENTINEL,'active':True,'commandHash':SENTINEL,'command':SENTINEL}]
            if n=='queue':return{'pending':-1,'unscoped':SENTINEL,'user_ids':SENTINEL}
            return original(n)
        h.sql=sql;out=m.collect(h,NOW);self.assertNotIn(SENTINEL,json.dumps(out));self.assertIsNone(out['queue']['pending'])
    def test_postgres_catalogue_alias_casing_preserves_permission_results(self):
        # Derive row keys from the actual SQL aliases, applying PostgreSQL's
        # unquoted-identifier folding. Do not supply assumed camelCase keys.
        aliases=re.findall(r'\bas\s+("[^"]+"|[A-Za-z_][A-Za-z_0-9]*)',m.SQL['catalogue'],re.I)
        keys=[a[1:-1]if a.startswith('"')else a.lower()for a in aliases]
        expected={'bodyHash':'c'*32,'securityDefiner':True,'anonymousExecute':True,'authenticatedExecute':True}
        row={'schema':'public','name':'customer_session_is_live'}
        for key in keys:
            if key.lower()in{k.lower()for k in expected}:
                row[key]=next(v for k,v in expected.items()if k.lower()==key.lower())
        h=FakeHost();original=h.sql
        def sql(n):
            value=original(n)
            if n=='catalogue':value['routineMetadata']=[row]
            return value
        h.sql=sql
        projected=m.collect(h,NOW)['database']['routineMetadata'][0]
        for key,value in expected.items():self.assertEqual(projected[key],value)
    def test_missing_or_wrong_case_routine_metadata_fails_closed(self):
        h=FakeHost();original=h.sql
        def sql(n):
            value=original(n)
            if n=='catalogue':value['routineMetadata']=[{'schema':'public','name':'customer_session_is_live','bodyhash':'c'*32,'securitydefiner':True,'anonymousexecute':True,'authenticatedexecute':True}]
            return value
        h.sql=sql
        with self.assertRaisesRegex(ValueError,'UNEXPECTED_ROUTINE_METADATA'):m.collect(h,NOW)
    def test_host_sql_allows_only_fixed_read_only_queries(self):
        h=m.Host();calls=[]
        h.run=lambda args:calls.append(args)or'{}'
        h.sql('catalogue');q=calls[0][-1];self.assertTrue(q.startswith('BEGIN READ ONLY;'));self.assertTrue(q.endswith('ROLLBACK;'));self.assertIn('-X',calls[0]);self.assertIn('statement_timeout=8000',q)
        with self.assertRaises(KeyError):h.sql('untrusted')
        for text in m.SQL.values():
            for word in ['INSERT ','UPDATE ','DELETE ','CREATE ','ALTER ','DROP ','COPY ','pg_read_file','pg_ls_dir','set_config(']:self.assertNotIn(word.lower(),text.lower())
    def test_host_rejects_unapproved_container_timer_and_key_reference(self):
        h=m.Host();h.run=lambda args:(_ for _ in()).throw(AssertionError('must not execute'))
        with self.assertRaises(ValueError):h.runtime('other')
        with self.assertRaises(ValueError):h.environment('other')
        with self.assertRaises(ValueError):h.timer('other')
        self.assertFalse(h.key_stat('/etc/shadow')['configuredReferenceAllowed'])
if __name__=='__main__':unittest.main()
