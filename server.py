#!/usr/bin/env python3
"""Prowell Jobs MVP server: Python 3.10+, SQLite, no extra packages.

Start with: ADMIN_KEY='use-a-long-random-secret' python server.py
Public posts are pending until an administrator approves them at /admin.html.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.getenv('DATABASE_PATH', str(ROOT / 'prowell-jobs.sqlite3'))).resolve()
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
PORT = int(os.getenv('PORT', '8000'))
# Never launch online with a temporary administrator credential.
if os.getenv('RAILWAY_ENVIRONMENT') and not os.getenv('ADMIN_KEY'):
    raise RuntimeError('Set a strong ADMIN_KEY in Railway service Variables before deployment.')
ADMIN_KEY = os.getenv('ADMIN_KEY') or secrets.token_urlsafe(24)
if not os.getenv('ADMIN_KEY'):
    print(f'\n[Prowell Jobs] Admin key (temporary, changes at restart): {ADMIN_KEY}', flush=True)
    print('[Prowell Jobs] Set the ADMIN_KEY environment variable for a permanent admin key.\n', flush=True)
rate_lock = threading.Lock()
last_submissions: dict[str, list[float]] = {}
CATEGORIES = {'Technology', 'Healthcare', 'Finance', 'Marketing', 'Operations', 'Customer Support', 'Education', 'Design', 'Sales', 'Other'}
MODES = {'Remote', 'Hybrid', 'On-site'}
TYPES = {'Full-time', 'Part-time', 'Contract', 'Internship'}
EXPERIENCE = {'Entry level', 'Mid level', 'Senior level'}
CURRENCIES = {'KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'}
FIELDS = ('id', 'title', 'company', 'category', 'location', 'workMode', 'jobType', 'experience', 'currency', 'salaryMin', 'salaryMax', 'description', 'email', 'applyUrl', 'createdAt', 'status')


@contextmanager
def db_connection():
    """Commit transactions and close SQLite handles after each request."""
    db = sqlite3.connect(str(DATABASE_PATH), timeout=15)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize_db():
    with db_connection() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            workMode TEXT NOT NULL,
            jobType TEXT NOT NULL,
            experience TEXT NOT NULL,
            currency TEXT NOT NULL,
            salaryMin INTEGER,
            salaryMax INTEGER,
            description TEXT NOT NULL,
            email TEXT,
            applyUrl TEXT,
            createdAt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','approved','rejected'))
        )''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, createdAt DESC)')


def check_rate(ip):
    """Simple per-process burst control, not a replacement for production abuse protection."""
    now = time.monotonic()
    with rate_lock:
        previous = [t for t in last_submissions.get(ip, []) if now - t < 3600]
        if len(previous) >= 6:
            last_submissions[ip] = previous
            return False
        previous.append(now)
        last_submissions[ip] = previous
    return True


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError('Invalid submission.')
    clean = {}
    length_limits = {'title': 100, 'company': 100, 'category': 45, 'location': 100,
                     'workMode': 25, 'jobType': 25, 'experience': 25, 'currency': 8,
                     'description': 5000, 'email': 180, 'applyUrl': 500}
    for field, max_length in length_limits.items():
        value = payload.get(field, '')
        if not isinstance(value, str):
            raise ValueError(f'Invalid value for {field}.')
        clean[field] = value.strip()
        if len(clean[field]) > max_length:
            raise ValueError(f'{field} is too long.')
    for field in ('title','company','category','location','workMode','jobType','experience'):
        if not clean[field]:
            raise ValueError(f'{field} is required.')
    if clean['category'] not in CATEGORIES or clean['workMode'] not in MODES or clean['jobType'] not in TYPES or clean['experience'] not in EXPERIENCE:
        raise ValueError('Choose valid job options.')
    if clean['currency'] not in CURRENCIES:
        raise ValueError('Invalid currency.')
    if len(clean['description']) < 30:
        raise ValueError('Job description must be at least 30 characters.')
    if not clean['email'] and not clean['applyUrl']:
        raise ValueError('Add an application email or link.')
    if clean['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', clean['email']):
        raise ValueError('Enter a valid application email.')
    if clean['applyUrl']:
        url = urlsplit(clean['applyUrl'])
        if url.scheme not in ('http', 'https') or not url.netloc or url.username or url.password:
            raise ValueError('Application link must be a valid http(s) URL.')
    for field in ('salaryMin', 'salaryMax'):
        raw = payload.get(field)
        if raw in (None, ''):
            clean[field] = None
        elif isinstance(raw, bool) or not isinstance(raw, (int, float)) or not float(raw).is_integer() or not (0 <= raw <= 10**11):
            raise ValueError(f'{field} must be a nonnegative whole number.')
        else:
            clean[field] = int(raw)
    if clean['salaryMax'] is not None and clean['salaryMin'] is not None and clean['salaryMax'] < clean['salaryMin']:
        raise ValueError('Maximum salary must be at least the minimum.')
    clean['id'] = str(uuid.uuid4())
    clean['createdAt'] = datetime.now(timezone.utc).isoformat()
    clean['status'] = 'pending'
    return clean


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Frame-Options', 'DENY')
        self.end_headers()
        self.wfile.write(body)

    def check_admin(self):
        provided = self.headers.get('Authorization', '')
        return hmac.compare_digest(provided, f'Bearer {ADMIN_KEY}')

    def get_json_body(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 25_000:
                raise ValueError('Submission is too large or empty.')
            return json.loads(self.rfile.read(length))
        except (TypeError, json.JSONDecodeError):
            raise ValueError('Invalid JSON body.')

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/jobs':
            with db_connection() as db:
                rows = db.execute('SELECT * FROM jobs WHERE status = ? ORDER BY createdAt DESC LIMIT 1000', ('approved',)).fetchall()
            return self.send_json(200, {'jobs': [dict(row) for row in rows]})
        if path == '/api/admin/jobs':
            if not self.check_admin():
                return self.send_json(401, {'error': 'Invalid administrator key.'})
            with db_connection() as db:
                rows = db.execute('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT 1000').fetchall()
            return self.send_json(200, {'jobs': [dict(row) for row in rows]})
        if path == '/api/health':
            return self.send_json(200, {'status':'ok'})
        if path.startswith('/api/'):
            return self.send_json(404, {'error': 'Unknown endpoint.'})
        allowed_static = {'/', '/index.html', '/styles.css', '/app.js', '/admin.html', '/admin.js', '/favicon.svg'}
        if path not in allowed_static:
            return self.send_json(404, {'error': 'File not found.'})
        if path == '/':
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != '/api/jobs':
            return self.send_json(404, {'error': 'Unknown endpoint.'})
        try:
            payload = self.get_json_body()
            job = validate(payload)
        except ValueError as error:
            return self.send_json(400, {'error': str(error)})
        # Email verification, employer identity checks, and CAPTCHA should be added before public launch.
        if not check_rate(self.client_address[0]):
            return self.send_json(429, {'error': 'Posting limit reached. Please try again later.'})
        with db_connection() as db:
            db.execute('''INSERT INTO jobs(id,title,company,category,location,workMode,jobType,experience,currency,
                salaryMin,salaryMax,description,email,applyUrl,createdAt,status)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', [job[f] for f in FIELDS])
        return self.send_json(201, {'message': 'Submitted for administrator review.', 'id': job['id']})

    def do_PATCH(self):
        path = urlsplit(self.path).path
        if not path.startswith('/api/admin/jobs/'):
            return self.send_json(404, {'error': 'Unknown endpoint.'})
        if not self.check_admin():
            return self.send_json(401, {'error': 'Invalid administrator key.'})
        try:
            data = self.get_json_body()
            status = data.get('status') if isinstance(data, dict) else None
            if status not in ('pending', 'approved', 'rejected'):
                raise ValueError('Choose pending, approved, or rejected.')
            uuid.UUID(path.split('/')[-1])
        except (ValueError, AttributeError) as error:
            return self.send_json(400, {'error': str(error)})
        with db_connection() as db:
            result = db.execute('UPDATE jobs SET status = ? WHERE id = ?', (status, path.split('/')[-1]))
        if result.rowcount == 0:
            return self.send_json(404, {'error': 'Job not found.'})
        return self.send_json(200, {'message': 'Job updated.', 'status': status})

    def do_HEAD(self):
        if urlsplit(self.path).path.startswith('/api/'):
            self.send_response(405)
            self.send_header('Content-Length', '0')
            self.end_headers()
        elif urlsplit(self.path).path in {'/', '/index.html', '/styles.css', '/app.js', '/admin.html', '/admin.js', '/favicon.svg'}:
            super().do_HEAD()
        else:
            self.send_response(404)
            self.end_headers()

    def end_headers(self):
        # Standard security headers for static pages as well.
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        super().end_headers()


if __name__ == '__main__':
    initialize_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'[Prowell Jobs] Site: http://localhost:{PORT}/', flush=True)
    print(f'[Prowell Jobs] Admin: http://localhost:{PORT}/admin.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down.')
    finally:
        server.server_close()
