import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('normalize',Path(__file__).with_name('normalize-schema.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NormalizerTests(unittest.TestCase):
 def test_grant_order(self):self.assertEqual(m.normalize('GRANT USAGE ON SCHEMA "public" TO "postgres";\n\nGRANT USAGE ON SCHEMA "public" TO "anon";'),m.normalize('GRANT USAGE ON SCHEMA "public" TO "anon";\nGRANT USAGE ON SCHEMA "public" TO "postgres";'))
 def test_privilege_change(self):self.assertNotEqual(m.normalize('GRANT SELECT ON t TO anon;'),m.normalize('GRANT ALL ON t TO anon;'))
 def test_revoke_barrier(self):self.assertNotEqual(m.normalize('GRANT SELECT ON t TO anon;\nREVOKE SELECT ON t FROM anon;'),m.normalize('REVOKE SELECT ON t FROM anon;\nGRANT SELECT ON t TO anon;'))
 def test_body_preserved(self):
  s="CREATE FUNCTION f() RETURNS text AS $body$\nhello\n\nworld\n$body$ LANGUAGE sql;\n"
  self.assertEqual(m.normalize(s),s)
  self.assertNotEqual(m.normalize(s),m.normalize(s.replace('hello\n\nworld','hello\nworld')))
 def test_policy_change(self):self.assertNotEqual(m.normalize('CREATE POLICY p ON t USING (true);'),m.normalize('CREATE POLICY p ON t USING (false);'))
 def test_header(self):self.assertEqual(m.normalize('-- Dumped by pg_dump version 17\n\nSELECT 1;'), 'SELECT 1;\n')

 def test_multiline_single(self):
  a="SELECT 'hello\n\nworld';\n"
  self.assertEqual(m.normalize(a),a)
  self.assertNotEqual(m.normalize(a),m.normalize(a.replace('hello\n\nworld','hello\nworld')))
 def test_embedded_dollar_in_single(self):
  a="SELECT '$body$';\n\nSELECT 2;\n"
  self.assertEqual(m.normalize(a),"SELECT '$body$';\nSELECT 2;\n")
 def test_quoted_identifier_multiline(self):
  a='SELECT "a$tag$\n\nb";\n'
  self.assertEqual(m.normalize(a),a)
  self.assertNotEqual(m.normalize(a),m.normalize(a.replace('\n\n','\n')))
 def test_comment_markers(self):
  a="/* $body$ ' \n\n /* nested */ end */\n-- $tag$\n\nSELECT 1;\n"
  self.assertIn("' \n\n",m.normalize(a));self.assertTrue(m.normalize(a).endswith('-- $tag$\nSELECT 1;\n'))
 def test_role_grants_untouched(self):
  a='GRANT role_a TO role_b WITH ADMIN TRUE;\nGRANT role_b TO role_c WITH INHERIT FALSE;\n'
  self.assertEqual(m.normalize(a),a);self.assertNotEqual(m.normalize(a),m.normalize('\n'.join(reversed(a.splitlines()))))
 def test_grant_options_not_sorted(self):
  a='GRANT USAGE ON SCHEMA "public" TO "postgres" WITH GRANT OPTION;\nGRANT USAGE ON SCHEMA "public" TO "anon";\n'
  self.assertEqual(m.normalize(a),a)
 def test_unterminated_rejected(self):
  with self.assertRaises(ValueError):m.normalize("SELECT '$unclosed;\n")

 def test_vertical_tab_literal(self):self.assertNotEqual(m.normalize("SELECT 'a\vb';\n"),m.normalize("SELECT 'a\nb';\n"))
 def test_literal_crlf_preserved(self):
  a="SELECT 'a\r\nb';\n";self.assertEqual(m.normalize(a),a);self.assertNotEqual(m.normalize(a),m.normalize(a.replace('\r\n','\n')))
 def test_unicode_separators(self):
  for c in ['\u2028','\u2029','\x85','\f']:
   a="SELECT 'a"+c+"b';\n";self.assertEqual(m.normalize(a),a);self.assertNotEqual(m.normalize(a),m.normalize("SELECT 'a\nb';\n"))
 def test_plain_backslash_quote(self):self.assertEqual(m.normalize("SELECT 'a\\';\n\nSELECT 2;\n"),"SELECT 'a\\';\nSELECT 2;\n")
 def test_escape_string_quote(self):
  a="SELECT E'a\\'\n\nb';\n";self.assertEqual(m.normalize(a),a)
unittest.main()
