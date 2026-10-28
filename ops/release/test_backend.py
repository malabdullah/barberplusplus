import importlib.util, io, json, pathlib, tarfile, tempfile, unittest, zipfile
from unittest import mock

def module(name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

b = module('backend')
c = module('controller')

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
