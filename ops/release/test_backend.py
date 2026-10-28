import importlib.util, io, json, pathlib, tarfile, tempfile, unittest, zipfile

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
        for phase in ['RECEIVED', 'BACKEND_APPLIED', 'FRONTEND_REQUESTED', 'FAILED_ROLLED_BACK', 'FAILED_REQUIRES_OPERATOR']:
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

if __name__ == '__main__': unittest.main()
