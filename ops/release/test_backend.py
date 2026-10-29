import copy, datetime, importlib.util, io, json, os, pathlib, subprocess, tarfile, tempfile, unittest, zipfile
from unittest import mock

def module(name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

b = module('backend')
c = module('controller')
bundle = module('bundle')
backup = module('backup_policy')


class DokployAcknowledgement(unittest.TestCase):
    def client(self):
        client = c.Controller.__new__(c.Controller); client.key = 'synthetic-management-key'
        return client

    def test_empty_deploy_acknowledgement_allows_actual_health_verification(self):
        client = self.client()
        for body in [b'', b'  \n']:
            with self.subTest(body=body), mock.patch.object(c.urllib.request, 'urlopen', return_value=io.BytesIO(body)):
                self.assertEqual(client.dokploy('POST', 'application.deploy', {'applicationId':'synthetic'}), {})

    def test_empty_reads_or_other_writes_remain_invalid(self):
        for method, action in [('GET','application.one?applicationId=synthetic'), ('POST','application.saveDockerProvider')]:
            with self.subTest(action=action), mock.patch.object(c.urllib.request, 'urlopen', return_value=io.BytesIO(b'')):
                with self.assertRaises(json.JSONDecodeError): self.client().dokploy(method, action)

    def test_nonempty_deploy_response_requires_valid_json(self):
        with mock.patch.object(c.urllib.request, 'urlopen', return_value=io.BytesIO(b'not-json')):
            with self.assertRaises(json.JSONDecodeError): self.client().dokploy('POST', 'application.deploy')
        with mock.patch.object(c.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"queued":true}')):
            self.assertEqual(self.client().dokploy('POST','application.deploy'), {'queued':True})

    def test_failed_http_deployment_is_not_an_acknowledgement(self):
        error = c.urllib.error.HTTPError('http://synthetic.invalid', 500, 'failure', {}, None)
        with mock.patch.object(c.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(c.urllib.error.HTTPError): self.client().dokploy('POST','application.deploy')


class ProductionRuntimeHealth(unittest.TestCase):
    def test_unhealthy_starting_stopped_or_unprobed_runtime_blocks_before_sql(self):
        evidence = json.loads((pathlib.Path(__file__).resolve().parents[2] / 'docs/backup-readiness-example.json').read_text())
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        evidence['checked_at'] = stamp; evidence['latest_restore_drill']['completed_at'] = stamp
        states = [
            {'Running':True,'Health':{'Status':'unhealthy'}},
            {'Running':True,'Health':{'Status':'starting'}},
            {'Running':True},
            {'Running':False,'Health':{'Status':'healthy'}},
        ]
        for state in states:
            with self.subTest(state=state), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp); target = root/'source'; (target/'ops/release').mkdir(parents=True)
                (target/'ops/release/runtime-lock.json').write_text(json.dumps({'containers':{'synthetic':{'imageId':'synthetic-image'}}}))
                backend = b.Backend({'enabled':True,'stateDirectory':str(root/'state'),'adoptionFile':'adoption','backupEvidenceFile':'evidence'})
                backend.command = mock.Mock(return_value=json.dumps([{'Image':'synthetic-image','State':state}]))
                backend.sql = mock.Mock()
                with mock.patch.object(b,'private_json',side_effect=lambda path: {'status':'PASS','rehearsal':'PASS'} if path=='adoption' else evidence):
                    with self.assertRaisesRegex(ValueError,'runtime changed/unhealthy'): backend.preflight(target,{})
                backend.sql.assert_not_called()

    def apply_fixture(self, tmp, postflight):
        backend = b.Backend({'stateDirectory':tmp})
        backend.preflight = mock.Mock(side_effect=[[],postflight])
        backend.schema_fingerprint = mock.Mock(return_value='f'*64)
        backend.sql = mock.Mock()
        backend.functions = mock.Mock()
        return backend

    def test_backend_success_requires_post_update_readiness(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = self.apply_fixture(tmp, ValueError('synthetic service failed during update'))
            with self.assertRaisesRegex(ValueError,'service failed'): backend.apply(pathlib.Path(tmp),{'commit':'a'*40})
            self.assertEqual(backend.preflight.call_count,2)
            backend.functions.assert_called_once()
            self.assertEqual(len(backend.sql.call_args_list),1)
            self.assertTrue(backend.sql.call_args[0][0].startswith('UPDATE barber_release.schema_state'))

    def test_remaining_migration_after_update_cannot_report_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = self.apply_fixture(tmp, [{'name':'synthetic-pending'}])
            with self.assertRaisesRegex(ValueError,'Unapplied migrations'): backend.apply(pathlib.Path(tmp),{'commit':'a'*40})

    def test_successful_update_checks_readiness_before_and_after(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend = self.apply_fixture(tmp, [])
            result = backend.apply(pathlib.Path(tmp),{'commit':'a'*40})
            self.assertEqual(result,{'status':'BACKEND_APPLIED','migrationsApplied':0})
            self.assertEqual(backend.preflight.call_count,2)


class BackupReadinessSafety(unittest.TestCase):
    def fixture(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        evidence = json.loads((root / 'docs/backup-readiness-example.json').read_text())
        now = datetime.datetime.fromisoformat(evidence['checked_at'].replace('Z', '+00:00')).timestamp()
        return evidence, now

    def change(self, evidence, path, value):
        evidence = copy.deepcopy(evidence); target = evidence
        names = path.split('.')
        for name in names[:-1]: target = target[name]
        target[names[-1]] = value
        return evidence

    def test_complete_documented_recovery_evidence_passes(self):
        evidence, now = self.fixture()
        backup.verify_backup_readiness(evidence, now)

    def test_fresh_pass_summary_cannot_replace_wal_and_restore_evidence(self):
        evidence = {'status':'PASS','offHost':True,'restoreDrill':'PASS','checkedAt':1234567890}
        with self.assertRaises(ValueError): backup.verify_backup_readiness(evidence, 1234567890)
        with tempfile.TemporaryDirectory() as tmp:
            backend = b.Backend({'enabled':True,'stateDirectory':tmp,'adoptionFile':'synthetic-adoption','backupEvidenceFile':'synthetic-backup'})
            backend.command = mock.Mock(); backend.sql = mock.Mock()
            with mock.patch.object(b,'private_json',side_effect=[{'status':'PASS','rehearsal':'PASS'},evidence]):
                with self.assertRaises(ValueError): backend.preflight(pathlib.Path(tmp),{})
            backend.command.assert_not_called(); backend.sql.assert_not_called()

    def test_each_required_protection_must_be_verified(self):
        evidence, now = self.fixture()
        paths = ['offsite_destination','wal_archive.healthy','base_backup.healthy','object_backup.healthy','latest_restore_drill.database_restored','latest_restore_drill.storage_restored']
        for path in paths:
            for value in [False,None,1,'true']:
                with self.subTest(path=path,value=value):
                    with self.assertRaises(ValueError): backup.verify_backup_readiness(self.change(evidence,path,value),now)

    def test_stale_recovery_points_and_backups_block_releases(self):
        evidence, now = self.fixture()
        for path, limit in [('recoverable_point_age_seconds',900),('wal_archive.lag_seconds',900),('base_backup.age_seconds',90000),('object_backup.age_seconds',90000),('latest_restore_drill.achieved_rpo_seconds',900),('latest_restore_drill.achieved_rto_seconds',7200)]:
            for value in [-1,limit+1,True,None,'0',float('nan'),float('inf')]:
                with self.subTest(path=path,value=value):
                    with self.assertRaises(ValueError): backup.verify_backup_readiness(self.change(evidence,path,value),now)

    def test_fresh_report_does_not_refresh_old_recovery_point(self):
        evidence, now = self.fixture()
        evidence['recoverable_point_age_seconds'] = 901
        with self.assertRaises(ValueError): backup.verify_backup_readiness(evidence,now)

    def test_report_and_restore_timestamps_must_be_recent_and_timezone_aware(self):
        evidence, now = self.fixture()
        stamp = lambda seconds: datetime.datetime.fromtimestamp(seconds,datetime.timezone.utc).isoformat()
        for path, values in [('checked_at',[stamp(now+1),stamp(now-301),'2026-09-02T10:00:00','invalid',None]),('latest_restore_drill.completed_at',[stamp(now+1),stamp(now-92*86400-1),'invalid',None])]:
            for value in values:
                with self.subTest(path=path,value=value):
                    with self.assertRaises(ValueError): backup.verify_backup_readiness(self.change(evidence,path,value),now)

    def test_backend_policy_ignores_cli_clock_override(self):
        evidence, now = self.fixture()
        with mock.patch.dict(os.environ,{'BACKUP_CHECK_NOW_EPOCH':str(int(now))}):
            with mock.patch.object(backup.time,'time',return_value=now+301):
                with self.assertRaises(ValueError): backup.verify_backup_readiness(evidence)

    def test_operator_cli_and_backend_use_the_same_policy(self):
        evidence, now = self.fixture(); root = pathlib.Path(__file__).resolve().parents[2]
        env = dict(os.environ,BACKUP_CHECK_NOW_EPOCH=str(int(now)),PYTHONDONTWRITEBYTECODE='1')
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'evidence.json'
            for valid in [True,False]:
                evidence['wal_archive']['healthy'] = valid; path.write_text(json.dumps(evidence))
                result = subprocess.run(['sh',str(root/'scripts/verify-backup-readiness.sh'),str(path)],env=env,text=True,capture_output=True)
                self.assertEqual(result.returncode==0,valid,result.stderr)
            env['BACKUP_CHECK_NOW_EPOCH']='not-a-clock'
            self.assertNotEqual(subprocess.run(['sh',str(root/'scripts/verify-backup-readiness.sh'),str(path)],env=env,capture_output=True).returncode,0)

class ReleaseSafety(unittest.TestCase):
    def test_sql_rejects_side_effect_expressions_and_exposed_tables(self):
        for sql in ['CREATE TABLE public.x AS SELECT dangerous();', 'CREATE TABLE public.x (id int);', 'CREATE INDEX x ON public.bookings((dangerous()));', 'ALTER TABLE auth.users ADD COLUMN x text;', 'ALTER TABLE public.bookings ADD COLUMN x private.evil;', 'ALTER TABLE public.bookings ADD COLUMN x text DEFAULT evil();', 'ALTER TABLE public.bookings ADD COLUMN x text; DROP TABLE public.bookings;', '/* x */ ALTER TABLE public.bookings ADD COLUMN x text;']:
            with self.subTest(sql=sql): self.assertFalse(b.automatic_sql(sql))

    def test_sql_additive_subset(self):
        for sql in ['ALTER TABLE public.bookings ADD COLUMN x text;', 'CREATE INDEX x ON public.bookings(id, branch_id);']:
            self.assertTrue(b.automatic_sql(sql))

    def test_interrupted_or_failed_release_never_automatically_retries(self):
        for phase in ['VERIFIED','RECEIVED','BACKEND_APPLYING','BACKEND_APPLIED','FRONTEND_REQUESTED','FAILED_PREPARATION','FAILED_ROLLED_BACK','FAILED_REQUIRES_OPERATOR']:
            with self.subTest(phase=phase):
                with self.assertRaises(ValueError): c.resume_policy({'phase': phase, 'commit': 'a' * 40}, 'a' * 40)
        c.resume_policy({'phase': 'COMPLETE'}, 'b' * 40)

    def test_zip_members_are_exact_and_digest_is_verified(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as z: z.writestr('../release.json', '{}')
        raw = data.getvalue()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): c.unpack_release(raw, 'sha256:' + c.digest(raw), pathlib.Path(tmp))
            with self.assertRaises(ValueError): c.unpack_release(raw, 'sha256:' + '0' * 64, pathlib.Path(tmp))

    def test_tar_traversal_and_symlink_refused_before_writing(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('supabase/functions/x/link', tarfile.SYMTYPE)]:
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode='w:gz') as t:
                info = tarfile.TarInfo(name); info.type = kind; info.linkname = '/etc/passwd'; t.addfile(info)
            blob = buf.getvalue(); zipped = io.BytesIO()
            manifest = {'commit': 'a' * 40, 'repository': 'malabdullah/barberplusplus', 'ref': 'refs/heads/main', 'compatibility': 'backward-compatible', 'backendSha256': b.digest(blob)}
            with zipfile.ZipFile(zipped, 'w') as z:
                z.writestr('release.json', json.dumps(manifest)); z.writestr('backend.tar.gz', blob)
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError): b.extract_bundle(zipped.getvalue(), 'a' * 40, pathlib.Path(tmp))
                self.assertEqual(list(pathlib.Path(tmp).iterdir()), [])

    def test_non_root_or_readable_config_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'secret'; p.write_text('{}'); p.chmod(0o644)
            with self.assertRaises(ValueError): b.private_json(p)

    def public_release(self):
        run={'id':123,'run_attempt':2,'head_sha':'a'*40}
        asset={'id':7,'name':'production-release-'+run['head_sha']+'.zip','state':'uploaded','size':25,'digest':'sha256:'+'b'*64,'url':'https://api.github.com/repos/malabdullah/barberplusplus/releases/assets/7'}
        release={'tag_name':'build-123-2','draft':False,'prerelease':True,'target_commitish':run['head_sha'],'assets':[asset]}
        return run,release,asset

    def test_public_build_is_bound_to_commit_run_attempt_and_digest(self):
        run,release,asset=self.public_release()
        self.assertEqual(c.release_asset(release,run),asset)
        for fields in [{'tag_name':'build-123-1'},{'draft':True},{'prerelease':False},{'target_commitish':'main'},{'assets':[asset,asset]}]:
            with self.subTest(fields=fields):
                with self.assertRaises(ValueError):c.release_asset(dict(release,**fields),run)
        for fields in [{'digest':None},{'size':0},{'size':True},{'state':'new'},{'url':'https://api.github.com/repos/other/repo/releases/assets/7'}]:
            with self.subTest(fields=fields):
                with self.assertRaises((ValueError,TypeError)):c.release_asset(dict(release,assets=[dict(asset,**fields)]),run)

    def test_public_bundle_excludes_environment_files_and_is_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'subjects';source.mkdir()
            (source/'release.json').write_text('{}');(source/'backend.tar.gz').write_bytes(b'public source')
            (source/'.env').write_text('SYNTHETIC_PRIVATE_VALUE=must-never-publish')
            one=bundle.bundle(source,root/'one.zip');two=bundle.bundle(source,root/'two.zip')
            self.assertEqual(one.read_bytes(),two.read_bytes())
            with zipfile.ZipFile(one) as z:self.assertEqual(sorted(z.namelist()),['backend.tar.gz','release.json'])
            self.assertNotIn(b'must-never-publish',one.read_bytes())
            with self.assertRaises(FileExistsError):bundle.bundle(source,one)

    def test_download_refuses_credential_urls_non_https_and_host_suffix_tricks(self):
        for url in ['http://release-assets.githubusercontent.com/file','https://github.com.evil.test/file','https://githubusercontent.com.evil.test/file','https://api.github.com@evil.test/file','https://api.github.com:444/file','file:///etc/passwd','https://user:secret@github.com/file']:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):c.download_url(url)
        c.download_url('https://release-assets.githubusercontent.com/file?signed=public-download')

    def test_download_checks_every_redirect_and_never_sends_credentials(self):
        controller=c.Controller.__new__(c.Controller);payload=b'public bundle';asset={'url':'https://api.github.com/repos/malabdullah/barberplusplus/releases/assets/7','size':len(payload),'digest':'sha256:'+c.digest(payload)}
        calls=[]
        def respond(request,timeout):
            calls.append(request)
            self.assertIsNone(request.get_header('Authorization'))
            if len(calls)==1:raise c.urllib.error.HTTPError(request.full_url,302,'redirect',{'Location':'https://release-assets.githubusercontent.com/file'},None)
            return io.BytesIO(payload)
        opener=mock.Mock();opener.open.side_effect=respond
        with mock.patch.object(c.urllib.request,'build_opener',return_value=opener):self.assertEqual(controller.artifact(asset),payload)
        self.assertEqual(len(calls),2)
        opener.open.side_effect=[c.urllib.error.HTTPError(asset['url'],302,'redirect',{'Location':'https://release-assets.githubusercontent.com/file'},None),c.urllib.error.HTTPError('https://release-assets.githubusercontent.com/file',302,'redirect',{'Location':'https://evil.test/steal'},None)]
        with mock.patch.object(c.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(ValueError):controller.artifact(asset)
        self.assertEqual(opener.open.call_count,4)

    def test_download_rejects_truncated_or_changed_public_asset(self):
        controller=c.Controller.__new__(c.Controller);asset={'url':'https://api.github.com/repos/malabdullah/barberplusplus/releases/assets/7','size':4,'digest':'sha256:'+c.digest(b'good')}
        for payload in [b'bad',b'evil']:
            opener=mock.Mock();opener.open.return_value=io.BytesIO(payload)
            with mock.patch.object(c.urllib.request,'build_opener',return_value=opener):
                with self.assertRaises(ValueError):controller.artifact(asset)

    def test_desired_swarm_image_is_not_accepted_as_running_release(self):
        controller=c.Controller.__new__(c.Controller);controller.c={'appName':'synthetic-app'}
        image='ghcr.io/malabdullah/barberplusplus@sha256:'+'a'*64
        task={'DesiredState':'running','Status':{'State':'running','ContainerStatus':{'ContainerID':'b'*64}},'Spec':{'ContainerSpec':{'Image':image}}}
        container={'State':{'Running':True},'Config':{'Image':image},'Image':'sha256:actual-image-content'}
        def command(args):
            if args[:3]==['docker','service','ps']:return b'synthetictask123\n'
            if args[:4]==['docker','inspect','--type','task']:return json.dumps([task]).encode()
            if args[:4]==['docker','inspect','--type','container']:return json.dumps([container]).encode()
            if args[:3]==['docker','image','inspect']:return json.dumps([{'Id':'sha256:actual-image-content'}]).encode()
            raise AssertionError(args)
        controller.command=command
        self.assertTrue(controller.running_image(image))
        task['Status']['State']='starting';self.assertFalse(controller.running_image(image))
        task['Status']['State']='running';task['Spec']['ContainerSpec']['Image']='old-image';self.assertFalse(controller.running_image(image))
        task['Spec']['ContainerSpec']['Image']=image;container['Image']='sha256:old-content';self.assertFalse(controller.running_image(image))
        container['Image']='sha256:actual-image-content';container['State']['Running']=False;self.assertFalse(controller.running_image(image))

    def test_backend_exit_zero_with_wrong_acknowledgement_is_refused(self):
        controller=c.Controller.__new__(c.Controller);controller.c={'backendHost':'release@synthetic.invalid','backendKeyFile':'/synthetic/private-key'}
        controller.command=lambda *args,**kwargs:b'{"status":"BACKEND_BLOCKED"}'
        with self.assertRaises(ValueError):controller.backend('apply',{'commit':'a'*40})
        controller.command=lambda *args,**kwargs:b'{"status":"BACKEND_APPLIED"}'
        self.assertEqual(controller.backend('apply',{'commit':'a'*40})['status'],'BACKEND_APPLIED')

    def test_unsigned_public_bundle_never_reaches_backend_or_frontend(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);controller=c.Controller.__new__(c.Controller);controller.root=root
            controller.c={'enabled':True,'repositoryId':1123713308,'applicationId':'synthetic-app'}
            previous='a'*40;commit='b'*40;old_image='ghcr.io/malabdullah/barberplusplus@sha256:'+'c'*64
            (root/'state.json').write_text(json.dumps({'phase':'COMPLETE','deployedCommit':previous}))
            run,release,asset=self.public_release();run.update(head_sha=commit,path=c.WORKFLOW,event='push',head_branch='main',conclusion='success',repository={'id':1123713308},head_repository={'id':1123713308})
            manifest={'schemaVersion':1,'repository':c.REPO,'ref':'refs/heads/main','workflow':c.WORKFLOW,'commit':commit,'runId':str(run['id']),'runAttempt':run['run_attempt'],'backendFile':'backend.tar.gz','compatibility':'backward-compatible','frontendImage':'ghcr.io/malabdullah/barberplusplus@sha256:'+'d'*64,'backendSha256':c.digest(b'source'),'runtimeLockSha256':'e'*64,'expectedSchemaSha256':'f'*64,'migrations':[{'name':'20260901000000_baseline.sql','sha256':'e'*64}]}
            raw=io.BytesIO()
            with zipfile.ZipFile(raw,'w') as z:z.writestr('release.json',json.dumps(manifest));z.writestr('backend.tar.gz',b'source')
            raw=raw.getvalue();asset.update(name='production-release-'+commit+'.zip',size=len(raw),digest='sha256:'+c.digest(raw));release.update(target_commitish=commit)
            def github(path):
                if path=='':return {'id':1123713308}
                if path.startswith('/actions/workflows/'):return {'workflow_runs':[run]}
                if path.startswith('/actions/runs/'):return run
                if path=='/releases/tags/build-123-2':return release
                raise AssertionError(path)
            controller.github=github;controller.command=lambda args:(commit+'\trefs/heads/main\n').encode()
            controller.artifact=lambda value:raw;calls=[]
            controller.backend=lambda *args,**kwargs:calls.append('backend')
            controller.frontend=lambda *args,**kwargs:calls.append('frontend')
            controller.attest=mock.Mock(side_effect=ValueError('synthetic untrusted signature'))
            with mock.patch.object(c,'acceptance',return_value={'commit':previous,'frontendImage':old_image}):
                with self.assertRaises(ValueError):controller.once()
            self.assertEqual(calls,[])
            self.assertEqual(controller.attest.call_count,1)
            self.assertTrue(str(controller.attest.call_args[0][0]).endswith('.zip'))
            self.assertEqual(json.loads((root/'state.json').read_text())['deployedCommit'],previous)

    def function_fixture(self, folder):
        root=pathlib.Path(folder);live=root/'live';live.mkdir();target=root/'candidate';(target/'supabase/functions').mkdir(parents=True)
        for name in ['one','two','main']:
            p=live/name;p.mkdir();(p/'index.ts').write_text('original-'+name)
        adoption=root/'adoption.json';adoption.write_text(json.dumps({'functionNames':['one','two']}))
        backend=b.Backend({'stateDirectory':str(root/'state'),'functionsDirectory':str(live),'functionsContainer':'synthetic-runtime','adoptionFile':str(adoption)})
        commit='a'*40;(backend.root/commit).mkdir();calls=[]
        def command(args):
            calls.append(args)
            return json.dumps([{'State':{'Running':True}}]) if args[:2]==['docker','inspect'] else ''
        backend.command=command
        return backend,live,target,commit,calls

    def test_failed_backup_does_not_erase_unbacked_live_workers(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend,live,target,commit,calls=self.function_fixture(tmp)
            source=target/'supabase/functions'
            for name in ['one','two']:
                p=source/name;p.mkdir();(p/'index.ts').write_text('new-'+name)
            original=b.shutil.copytree
            def copy(src,dst,*args,**kwargs):
                if pathlib.Path(src)==live/'two':raise OSError('synthetic backup failure')
                return original(src,dst,*args,**kwargs)
            with mock.patch.object(b,'private_json',side_effect=lambda p:json.loads(pathlib.Path(p).read_text())):
                with mock.patch.object(b.shutil,'copytree',side_effect=copy):
                    with self.assertRaises(OSError):backend.functions(target,commit)
                backend.rollback(commit)
            for name in ['one','two','main']:self.assertEqual((live/name/'index.ts').read_text(),'original-'+name)
            self.assertEqual(calls,[])

    def test_function_addition_removal_and_rollback_preserve_gateway(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend,live,target,commit,calls=self.function_fixture(tmp)
            for name in ['one','added']:
                p=target/'supabase/functions'/name;p.mkdir();(p/'index.ts').write_text('new-'+name)
            with mock.patch.object(b,'private_json',side_effect=lambda p:json.loads(pathlib.Path(p).read_text())):
                backend.functions(target,commit)
                self.assertFalse((live/'two').exists());self.assertEqual((live/'added/index.ts').read_text(),'new-added')
                backend.rollback(commit)
            for name in ['one','two','main']:self.assertEqual((live/name/'index.ts').read_text(),'original-'+name)
            self.assertFalse((live/'added').exists())
            self.assertTrue(any(call[:2]==['docker','stop'] for call in calls))

    def test_frontend_only_release_does_not_restart_functions(self):
        with tempfile.TemporaryDirectory() as tmp:
            backend,live,target,commit,calls=self.function_fixture(tmp)
            for name in ['one','two']:
                p=target/'supabase/functions'/name;p.mkdir();(p/'index.ts').write_text('original-'+name)
            with mock.patch.object(b,'private_json',side_effect=lambda p:json.loads(pathlib.Path(p).read_text())):backend.functions(target,commit)
            self.assertEqual(calls,[])
            self.assertEqual(json.loads((backend.root/'state.json').read_text())['phase'],'FUNCTIONS_UNCHANGED')

    def test_failed_delivery_cannot_be_reported_as_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller=c.Controller.__new__(c.Controller);controller.root=pathlib.Path(tmp);controller.c={'enabled':True}
            commit='a'*40
            controller.command=lambda args:(commit+'\trefs/heads/main\n').encode()
            (controller.root/'state.json').write_text(json.dumps({'phase':'FAILED_ROLLED_BACK','deployedCommit':commit}))
            with mock.patch.object(c,'acceptance',return_value={'commit':commit}):
                with self.assertRaises(ValueError):controller.once()

    def test_first_enable_observes_initial_cutover_without_redeploying(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller=c.Controller.__new__(c.Controller);controller.root=pathlib.Path(tmp);controller.c={'enabled':True}
            commit='a'*40;image='ghcr.io/malabdullah/barberplusplus@sha256:'+'b'*64
            controller.command=lambda args:(commit+'\trefs/heads/main\n').encode()
            seen=[];controller.healthy=lambda value:seen.append(value)
            with mock.patch.object(c,'acceptance',return_value={'commit':commit,'frontendImage':image}):
                result=controller.once()
            self.assertEqual(result['status'],'INITIAL_ACCEPTED_RELEASE_OBSERVED')
            self.assertEqual(seen,[{'commit':commit,'frontendImage':image}])
            self.assertEqual(json.loads((controller.root/'state.json').read_text())['phase'],'COMPLETE')

if __name__ == '__main__': unittest.main()
