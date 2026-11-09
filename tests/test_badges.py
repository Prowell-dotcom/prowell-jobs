"""Unseen moderation badge counts: per-section, private, persistent after viewing."""
import json
import threading
import unittest
import uuid
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from test_smoke import server


class AdminUnreadBadgesTests(unittest.TestCase):
    def setUp(self):
        with server.rate_lock:
            server.submission_times.clear()

    @classmethod
    def setUpClass(cls):
        server.initialize_db()
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.worker = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.worker.join(timeout=5)
        cls.httpd.server_close()

    def setUp(self):
        self.cookies = CookieJar()
        self.client = build_opener(HTTPCookieProcessor(self.cookies))

    def api(self, method, route, data=None, csrf=None, authenticated=False):
        headers = {'Content-Type': 'application/json'}
        if csrf:
            headers['X-Admin-CSRF'] = csrf
        if authenticated:
            headers['Authorization'] = 'Bearer ' + server.ADMIN_KEY
        req = Request('http://127.0.0.1:' + str(self.port) + route,
                      data=json.dumps(data).encode() if data is not None else None,
                      headers=headers, method=method)
        try:
            with self.client.open(req, timeout=6) as response:
                return response.status, json.loads(response.read())
        except HTTPError as response:
            return response.code, json.loads(response.read())

    def login(self):
        status, result = self.api('POST', '/api/admin/login', {'adminKey': server.ADMIN_KEY})
        self.assertEqual(status, 200)
        return result['csrfToken']

    def create_report(self):
        report_id = str(uuid.uuid4())
        with server.db_connection() as db:
            db.execute('''INSERT INTO reports(id,subject,details,email,createdAt,status)
                VALUES(?,?,?,?,?,?)''', (report_id, 'Test unread report', 'Test data only', '', server.timestamp(), 'pending'))
        return report_id

    def create_review(self):
        review_id = str(uuid.uuid4())
        with server.db_connection() as db:
            db.execute('''INSERT INTO reviews(id,name,relationship,kind,rating,comment,createdAt,status)
                VALUES(?,?,?,?,?,?,?,?)''', (review_id, 'Test reviewer', 'Job seeker', 'comment', 5,
                          'A test comment only', server.timestamp(), 'pending'))
        return review_id

    def test_private_unread_counts_and_independent_view_tracking(self):
        status, _ = self.api('GET', '/api/admin/unread_counts')
        self.assertEqual(status, 401)
        status, _ = self.api('POST', '/api/admin/tab-viewed', {'section':'reports'})
        self.assertEqual(status, 401)
        csrf = self.login()
        # Establish fresh starting positions, without deleting any other test data.
        for section in server.ADMIN_TABS:
            status, _ = self.api('POST', '/api/admin/tab-viewed', {'section':section}, csrf)
            self.assertEqual(status, 200)
        self.create_report()
        self.create_report()
        self.create_review()
        status, data = self.api('GET', '/api/admin/unread_counts')
        self.assertEqual(status, 200)
        self.assertEqual(data['unread']['reports'], 2)
        self.assertEqual(data['unread']['reviews'], 1)
        self.assertEqual(set(data['unread']), set(server.ADMIN_TABS))
        status, _ = self.api('POST', '/api/admin/tab-viewed', {'section':'reports'})
        self.assertEqual(status, 403, 'Session mutation must require CSRF')
        status, _ = self.api('POST', '/api/admin/tab-viewed', {'section':'other'}, csrf)
        self.assertEqual(status, 400)
        status, _ = self.api('POST', '/api/admin/tab-viewed', {'section':'reports'}, csrf)
        self.assertEqual(status, 200)
        status, data = self.api('GET', '/api/admin/unread_counts')
        self.assertEqual(data['unread']['reports'], 0)
        self.assertEqual(data['unread']['reviews'], 1)
        # Persist even after refresh, logout and another administrator login.
        self.api('POST', '/api/admin/logout', csrf=csrf)
        self.login()
        status, data = self.api('GET', '/api/admin/unread_counts')
        self.assertEqual(data['unread']['reports'], 0)
        self.create_report()
        status, data = self.api('GET', '/api/admin/unread_counts')
        self.assertEqual(data['unread']['reports'], 1)


if __name__ == '__main__':
    unittest.main()
