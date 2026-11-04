"""Small dependency-free checks for the Prowell Jobs MVP API."""
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

_temp_dir = tempfile.TemporaryDirectory()
os.environ['DATABASE_PATH'] = str(Path(_temp_dir.name) / 'test.sqlite3')
os.environ['ADMIN_KEY'] = 'test-key-not-a-production-secret'
import server  # noqa: E402  (environment must be configured before import)


class JobBoardTests(unittest.TestCase):
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
        _temp_dir.cleanup()

    def api(self, method, path, payload=None, authorized=False):
        headers = {}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        if authorized:
            headers['Authorization'] = 'Bearer test-key-not-a-production-secret'
        req = Request(f'http://127.0.0.1:{self.port}{path}', data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=5) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def test_homepage_and_health(self):
        status, body = self.api('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(b'Prowell', body)
        status, body = self.api('GET', '/api/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['status'], 'ok')

    def test_submission_is_moderated(self):
        job = {
            'title': 'Example QA Analyst', 'company': 'Example Employer',
            'category': 'Technology', 'location': 'Nairobi, Kenya',
            'workMode': 'Hybrid', 'jobType': 'Full-time',
            'experience': 'Entry level', 'currency': 'KES',
            'description': 'A clearly marked test job posting for automated QA checks only.',
            'email': 'example@example.com', 'applyUrl': '',
            'salaryMin': 40000, 'salaryMax': 60000,
        }
        status, body = self.api('POST', '/api/jobs', job)
        self.assertEqual(status, 201)
        job_id = json.loads(body)['id']
        status, body = self.api('GET', '/api/jobs')
        self.assertEqual(status, 200)
        self.assertNotIn(job_id, [j['id'] for j in json.loads(body)['jobs']])
        status, _ = self.api('GET', '/api/admin/jobs')
        self.assertEqual(status, 401)
        status, body = self.api('PATCH', f'/api/admin/jobs/{job_id}', {'status': 'approved'}, authorized=True)
        self.assertEqual(status, 200, body.decode('utf8'))
        status, body = self.api('GET', '/api/jobs')
        self.assertIn(job_id, [j['id'] for j in json.loads(body)['jobs']])
        status, _ = self.api('PATCH', f'/api/admin/jobs/{job_id}', {'status': 'rejected'}, authorized=True)
        self.assertEqual(status, 200)
        status, body = self.api('GET', '/api/jobs')
        self.assertNotIn(job_id, [j['id'] for j in json.loads(body)['jobs']])


if __name__ == '__main__':
    unittest.main()
