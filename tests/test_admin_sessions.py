"""Session persistence, logout, CSRF and notification diagnostics, all offline."""
import json
import os
import threading
import unittest
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from test_smoke import server


class AdminSessionTests(unittest.TestCase):
    def setUp(self):
        with server.rate_lock:
            server.submission_times.clear()

    @classmethod
    def setUpClass(cls):
        server.initialize_db()
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.thread.join(timeout=5)
        cls.httpd.server_close()

    def setUp(self):
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))

    def api(self, method, path, payload=None, csrf=None):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-Admin-CSRF'] = csrf
        req = Request(f'http://127.0.0.1:{self.port}{path}',
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=5) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def login(self):
        status, reply = self.api('POST', '/api/admin/login', {'adminKey': server.ADMIN_KEY})
        self.assertEqual(status, 200, reply)
        self.assertTrue(reply['authenticated'])
        return reply['csrfToken']

    def test_key_authentication_and_cookie_persist_across_requests(self):
        status, data = self.api('GET', '/api/admin/session')
        self.assertEqual(status, 200)
        self.assertFalse(data['authenticated'])
        status, _ = self.api('POST', '/api/admin/login', {'adminKey': 'incorrect-key'})
        self.assertEqual(status, 401)
        csrf = self.login()
        self.assertEqual(len(list(self.cookies)), 1)
        self.assertTrue('HttpOnly' in list(self.cookies)[0]._rest)
        self.assertEqual(list(self.cookies)[0]._rest.get('SameSite'), 'Strict')
        status, result = self.api('GET', '/api/admin/session')
        self.assertEqual(status, 200)
        self.assertTrue(result['authenticated'])
        self.assertEqual(result['csrfToken'], csrf)
        status, data = self.api('GET', '/api/admin/jobs')
        self.assertEqual(status, 200)
        self.assertIn('jobs', data)

    def test_csrf_guard_and_logout_revocation(self):
        csrf = self.login()
        status, _ = self.api('POST', '/api/admin/notifications/test')
        self.assertEqual(status, 403)
        status, data = self.api('POST', '/api/admin/logout', csrf='incorrect')
        self.assertEqual(status, 403)
        status, data = self.api('POST', '/api/admin/logout', csrf=csrf)
        self.assertEqual(status, 200)
        self.assertFalse(data['authenticated'])
        status, data = self.api('GET', '/api/admin/session')
        self.assertEqual(status, 200)
        self.assertFalse(data['authenticated'])
        status, _ = self.api('GET', '/api/admin/notification_status')
        self.assertEqual(status, 401)

    def test_test_email_queues_once_and_is_private(self):
        csrf = self.login()
        status, _ = self.api('GET', '/api/admin/notification_status')
        self.assertEqual(status, 200)
        with patch.dict(os.environ, {'RESEND_API_KEY': 'offline-test-only',
                                     'NOTIFY_FROM_EMAIL': 'notifications@prowelljobs.com',
                                     'ADMIN_NOTIFICATION_EMAIL': 'prowellofficial@gmail.com'}):
            status, result = self.api('GET', '/api/admin/notification_status')
            self.assertEqual(status, 200)
            self.assertTrue(result['emailConfigured'])
            with patch.object(server, 'send_notification') as mocked_send:
                status, result = self.api('POST', '/api/admin/notifications/test', csrf=csrf)
                self.assertEqual(status, 202, result)
                self.assertEqual(result['status'], 'sent')
                mocked_send.assert_called_once()
            status, result = self.api('POST', '/api/admin/notifications/test', csrf=csrf)
            self.assertEqual(status, 429)
            status, result = self.api('GET', '/api/admin/notification_outbox')
            self.assertEqual(status, 200)
            tests = [row for row in result['notification_outbox'] if row['kind'] == 'admin_test']
            self.assertEqual(len(tests), 1)
            self.assertEqual(tests[0]['recipient'], 'prowellofficial@gmail.com')
            status, _ = self.api('GET', '/api/admin/notification_status')
            self.assertEqual(status, 200)
        # Ensure test is never readable without an admin session.
        self.cookies.clear()
        status, _ = self.api('GET', '/api/admin/notification_outbox')
        self.assertEqual(status, 401)


if __name__ == '__main__':
    unittest.main()
