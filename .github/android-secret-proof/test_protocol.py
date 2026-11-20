"""Fake-only input checks; no credentials, commands, files or network."""
import base64, copy, json, unittest
import credential_protocol as p

def fixture():
    return {'fcm': {'type': 'service_account', 'project_id': p.PROJECT, 'private_key_id': 'a' * 40, 'private_key': '-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----\n', 'client_email': p.SENDER, 'client_id': '123456', 'auth_uri': 'https://accounts.google.com/o/oauth2/auth', 'token_uri': 'https://oauth2.googleapis.com/token', 'auth_provider_x509_cert_url': 'https://www.googleapis.com/oauth2/v1/certs', 'client_x509_cert_url': 'https://www.googleapis.com/robot/v1/metadata/x509/barber-android-sender%40barber-plus-plus-phone-prod.iam.gserviceaccount.com'}, 'wakeSecret': 'b' * 64}

class Tests(unittest.TestCase):
    def test_standard_envelope(self):
        fcm, wake = p.envelope(json.dumps(fixture()).encode())
        self.assertEqual(json.loads(fcm), fixture()['fcm'])
        self.assertEqual(wake, 'b' * 64)
    def test_duplicate_json_field_refused(self):
        with self.assertRaises(ValueError): p.envelope(b'{"fcm":{},"fcm":{},"wakeSecret":"invalid"}')
    def test_wrong_identity_refused(self):
        for key, value in [('project_id', 'another'), ('client_email', 'another@example.test'), ('token_uri', 'https://example.test')]:
            data = fixture(); data['fcm'][key] = value
            with self.assertRaises(ValueError): p.envelope(json.dumps(data).encode())
    def test_wake_is_only_exact_lower_hex(self):
        for value in ['b' * 63, 'b' * 65, 'B' * 64, 'b' * 63 + '\n', None]:
            data = fixture(); data['wakeSecret'] = value
            with self.assertRaises(ValueError): p.envelope(json.dumps(data).encode())
    def test_unknown_fields_and_oversize_refused(self):
        data = fixture(); data['sql'] = 'never executed'
        with self.assertRaises(ValueError): p.envelope(json.dumps(data).encode())
        with self.assertRaises(ValueError): p.envelope(b' ' * (p.MAX_INPUT + 1))
    def test_meta_command_characters_become_alphabet_only(self):
        for value in ["'\\bind\n", '`false`:USER', 'صالون']:
            encoded = p.encoded_parameter(value)
            self.assertRegex(encoded, '^[A-Za-z0-9+/]*={0,2}$')
            self.assertEqual(base64.b64decode(encoded).decode(), value)
    def test_fixed_sql_uses_placeholders_only(self):
        self.assertIn('$1', p.CREATE); self.assertIn('$2', p.CREATE)
        self.assertNotIn('log_statement=', p.PARAMETER_REDACTION)
        self.assertNotIn('log_min_error_statement=', p.PARAMETER_REDACTION)
        self.assertNotIn('pgaudit.log=', p.PARAMETER_REDACTION)
    def test_only_sqlstate_returned(self):
        self.assertEqual(p.safe_sqlstate(b'ERROR:  22012\n'), '22012')
        self.assertIsNone(p.safe_sqlstate(b'private message'))

if __name__ == '__main__': unittest.main()
