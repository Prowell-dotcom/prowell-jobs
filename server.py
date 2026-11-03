#!/usr/bin/env python3
"""Prowell Jobs community job board. Python 3.10+, SQLite, no pip installs.

This is a moderated MVP, not a fully authenticated hiring/HR platform.
Public candidate previews deliberately exclude private contact details.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.getenv('DATABASE_PATH', str(ROOT / 'prowell-jobs.sqlite3'))).resolve()
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
PORT = int(os.getenv('PORT', '8000'))
if os.getenv('RAILWAY_ENVIRONMENT') and not os.getenv('ADMIN_KEY'):
    raise RuntimeError('Set a strong ADMIN_KEY in Railway service Variables before deployment.')
ADMIN_KEY = os.getenv('ADMIN_KEY') or secrets.token_urlsafe(24)
if not os.getenv('ADMIN_KEY'):
    print('[Prowell Jobs] Temporary admin key (changes at restart):', ADMIN_KEY, flush=True)
rate_lock = threading.Lock()
submission_times: dict[str, list[float]] = {}

CATEGORIES = {
    'Technology', 'Healthcare', 'Finance', 'Marketing', 'Operations', 'Customer Support',
    'Education', 'Design', 'Sales', 'Other',
    'Transport & Ride-hailing', 'Delivery & Logistics', 'Domestic & Home Help',
    'Cleaning & Housekeeping', 'Construction & Trades', 'Agriculture & Farming',
    'Hospitality & Food', 'Retail & Shop Work', 'Security & Safety',
    'Factory & Manufacturing', 'Beauty & Personal Care', 'Events & Entertainment',
    'Skilled Services & Repairs', 'Engineering & Architecture', 'Legal & Public Service',
    'Tourism & Travel', 'Nonprofit & Community', 'Media & Creative', 'Caregiving',
    'Business & Administration', 'Freelance & Online Work', 'Warehouse & General Labour'
}
MODES = {'Remote', 'Hybrid', 'On-site', 'Mobile / field work'}
TYPES = {'Full-time', 'Part-time', 'Contract', 'Internship', 'Casual / day work',
         'Gig / per task', 'Seasonal', 'Apprenticeship', 'Self-employed opportunity'}
EXPERIENCE = {'No experience needed', 'Entry level', 'Mid level', 'Senior level', 'Any level'}
CURRENCIES = {'KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS', 'NGN', 'GHS', 'ZAR',
              'CAD', 'AUD', 'AED', 'INR', 'PHP', 'PKR', 'BRL', 'JPY', 'Other'}
PAY_PERIODS = {'hour', 'day', 'week', 'month', 'year', 'trip', 'task', 'negotiable'}
JOB_COLUMNS = ('id','title','company','category','location','workMode','jobType','experience','currency',
               'salaryMin','salaryMax','description','email','applyUrl','createdAt','status',
               'country','requirements','responsibilities','benefits','deadline','payPeriod','phone','verified')
STATUS_VALUES = ('pending','approved','rejected')


def timestamp():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db_connection():
    db = sqlite3.connect(str(DATABASE_PATH), timeout=20)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize_db():
    with db_connection() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,title TEXT NOT NULL,company TEXT NOT NULL,category TEXT NOT NULL,
            location TEXT NOT NULL,workMode TEXT NOT NULL,jobType TEXT NOT NULL,
            experience TEXT NOT NULL,currency TEXT NOT NULL,salaryMin INTEGER,salaryMax INTEGER,
            description TEXT NOT NULL,email TEXT,applyUrl TEXT,createdAt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending')''')
        # Safe additive migration: existing Railway vacancy records are kept.
        cols = {r['name'] for r in db.execute('PRAGMA table_info(jobs)')}
        for column, sqltype in (
            ('country','TEXT'), ('requirements','TEXT'), ('responsibilities','TEXT'),
            ('benefits','TEXT'), ('deadline','TEXT'), ('payPeriod',"TEXT DEFAULT 'month'"),
            ('phone','TEXT'), ('verified','INTEGER NOT NULL DEFAULT 0')
        ):
            if column not in cols:
                db.execute(f'ALTER TABLE jobs ADD COLUMN {column} {sqltype}')
        db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, createdAt DESC)')
        db.execute('''CREATE TABLE IF NOT EXISTS candidates (
            id TEXT PRIMARY KEY,alias TEXT NOT NULL,category TEXT NOT NULL,country TEXT NOT NULL,
            city TEXT,skills TEXT NOT NULL,experience TEXT NOT NULL,availability TEXT NOT NULL,
            summary TEXT NOT NULL,currency TEXT,payExpectation TEXT,
            email TEXT NOT NULL,phone TEXT,consent INTEGER NOT NULL,
            withdrawalHash TEXT NOT NULL,createdAt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending')''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status, createdAt DESC)')
        db.execute('''CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,name TEXT NOT NULL,relationship TEXT NOT NULL,kind TEXT NOT NULL,
            rating INTEGER,comment TEXT NOT NULL,createdAt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending')''')
        db.execute('''CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,subject TEXT NOT NULL,details TEXT NOT NULL,email TEXT,
            createdAt TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending')''')
        db.execute('''CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,email TEXT NOT NULL,category TEXT,country TEXT,
            consent INTEGER NOT NULL,createdAt TEXT NOT NULL)''')


def check_rate(ip: str, bucket: str, limit: int = 6) -> bool:
    now = time.monotonic()
    key = bucket + ':' + ip
    with rate_lock:
        # Limit memory use by pruning old counters regularly.
        if len(submission_times) > 5000:
            for k in list(submission_times):
                submission_times[k] = [t for t in submission_times[k] if now - t < 3600]
                if not submission_times[k]:
                    del submission_times[k]
        recent = [t for t in submission_times.get(key, ()) if now - t < 3600]
        if len(recent) >= limit:
            submission_times[key] = recent
            return False
        recent.append(now)
        submission_times[key] = recent
    return True


def field(payload, name, max_len=250, required=False):
    value = payload.get(name, '')
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise ValueError(f'{name} must be text.')
    value = value.strip()
    if len(value) > max_len:
        raise ValueError(f'{name} is too long.')
    if required and not value:
        raise ValueError(f'{name} is required.')
    return value


def email_valid(value):
    return bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value))


def checked_email(value, required=False):
    if required and not value:
        raise ValueError('An email address is required.')
    if value and not email_valid(value):
        raise ValueError('Enter a valid email address.')
    return value


def require_consent(payload):
    if payload.get('consent') is not True:
        raise ValueError('Please read the privacy notice and give consent.')


def validate_job(payload):
    if not isinstance(payload, dict):
        raise ValueError('Invalid submission.')
    obj = {k: field(payload, k, limit, required) for k, limit, required in (
        ('title',120,True),('company',120,True),('category',55,True),
        ('location',120,True),('workMode',30,True),('jobType',35,True),
        ('experience',30,True),('currency',10,False),('description',5000,True),
        ('email',180,False),('applyUrl',500,False),('country',90,False),
        ('requirements',3500,False),('responsibilities',3500,False),('benefits',1500,False),
        ('deadline',10,False),('payPeriod',20,False),('phone',40,False)
    )}
    if obj['category'] not in CATEGORIES or obj['workMode'] not in MODES or obj['jobType'] not in TYPES or obj['experience'] not in EXPERIENCE:
        raise ValueError('Choose valid job options.')
    obj['currency'] = obj['currency'] or 'KES'
    obj['payPeriod'] = obj['payPeriod'] or 'month'
    if obj['currency'] not in CURRENCIES or obj['payPeriod'] not in PAY_PERIODS:
        raise ValueError('Choose a valid currency and pay interval.')
    if len(obj['description']) < 30:
        raise ValueError('Job description must be at least 30 characters.')
    if not obj['email'] and not obj['applyUrl'] and not obj['phone']:
        raise ValueError('Add an application email, phone number or link.')
    checked_email(obj['email'])
    if obj['applyUrl']:
        url = urlsplit(obj['applyUrl'])
        if url.scheme not in ('http','https') or not url.hostname or url.username or url.password:
            raise ValueError('Application link must be a valid http(s) URL.')
    if obj['deadline']:
        try:
            datetime.strptime(obj['deadline'], '%Y-%m-%d')
        except ValueError as exc:
            raise ValueError('Deadline must be a valid YYYY-MM-DD date.') from exc
    for number in ('salaryMin','salaryMax'):
        raw = payload.get(number)
        if raw in (None,''):
            obj[number] = None
        elif isinstance(raw, bool) or not isinstance(raw, (int,float)) or not float(raw).is_integer() or not 0 <= raw <= 10**11:
            raise ValueError(f'{number} must be a nonnegative whole number.')
        else:
            obj[number] = int(raw)
    if obj['salaryMin'] is not None and obj['salaryMax'] is not None and obj['salaryMax'] < obj['salaryMin']:
        raise ValueError('Maximum pay cannot be below minimum pay.')
    obj.update(id=str(uuid.uuid4()), createdAt=timestamp(), status='pending', verified=0)
    return obj


def validate_candidate(payload):
    if not isinstance(payload, dict):
        raise ValueError('Invalid submission.')
    require_consent(payload)
    obj = {key: field(payload, key, length, required) for key,length,required in (
        ('alias',70,True),('category',55,True),('country',90,True),('city',90,False),
        ('skills',700,True),('experience',30,True),('availability',90,True),
        ('summary',1500,True),('currency',10,False),('payExpectation',120,False),
        ('email',180,True),('phone',40,False))}
    if obj['category'] not in CATEGORIES or obj['experience'] not in EXPERIENCE:
        raise ValueError('Choose valid experience and sector options.')
    checked_email(obj['email'], required=True)
    if len(obj['summary']) < 20:
        raise ValueError('Write at least 20 characters about the work you want.')
    public_text = ' '.join(obj[k] for k in ('alias','skills','summary'))
    if re.search(r'[^\s@]+@[^\s@]+\.[^\s@]+', public_text):
        raise ValueError('Do not include an email address in public profile text.')
    obj['currency'] = obj['currency'] or 'KES'
    if obj['currency'] not in CURRENCIES:
        raise ValueError('Select a valid currency.')
    code = secrets.token_urlsafe(24)
    obj.update(id=str(uuid.uuid4()), withdrawalHash=hashlib.sha256(code.encode()).hexdigest(),
               consent=1, createdAt=timestamp(), status='pending')
    return obj, code


def validate_review(payload):
    if not isinstance(payload, dict):
        raise ValueError('Invalid submission.')
    obj = {k: field(payload,k,l,req) for k,l,req in (
        ('name',70,True),('relationship',60,True),('kind',15,True),('comment',1500,True))}
    if obj['kind'] not in ('review','comment'):
        raise ValueError('Select review or comment.')
    raw = payload.get('rating')
    if obj['kind'] == 'review':
        if type(raw) is not int or raw not in range(1,6):
            raise ValueError('Select a rating of 1 to 5.')
        obj['rating'] = raw
    else:
        obj['rating'] = None
    if len(obj['comment']) < 15:
        raise ValueError('Please write at least 15 characters.')
    obj.update(id=str(uuid.uuid4()),createdAt=timestamp(),status='pending')
    return obj


def validate_report(payload):
    if not isinstance(payload,dict):
        raise ValueError('Invalid submission.')
    obj = {k: field(payload,k,l,req) for k,l,req in (
        ('subject',200,True),('details',1500,True),('email',180,False))}
    checked_email(obj['email'])
    if len(obj['details']) < 20:
        raise ValueError('Provide at least 20 characters of detail.')
    obj.update(id=str(uuid.uuid4()),createdAt=timestamp(),status='pending')
    return obj


def validate_alert(payload):
    if not isinstance(payload,dict):
        raise ValueError('Invalid submission.')
    require_consent(payload)
    obj = {k:field(payload,k,l,req) for k,l,req in (
        ('email',180,True),('category',55,False),('country',90,False))}
    checked_email(obj['email'], required=True)
    if obj['category'] and obj['category'] not in CATEGORIES:
        raise ValueError('Select a valid job category.')
    obj.update(id=str(uuid.uuid4()),consent=1,createdAt=timestamp())
    return obj


PUBLIC_CANDIDATE_FIELDS = ('id','alias','category','country','city','skills','experience',
                           'availability','summary','currency','payExpectation','createdAt')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()')
        super().end_headers()

    def send_json(self,status,payload):
        data = json.dumps(payload,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        return hmac.compare_digest(self.headers.get('Authorization',''), f'Bearer {ADMIN_KEY}')

    def json_body(self):
        try:
            length = int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 30000:
                raise ValueError('Submission is too large or empty.')
            return json.loads(self.rfile.read(length))
        except (TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError('Invalid JSON.') from exc

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/health':
            return self.send_json(200,{'status':'ok','app':'Prowell Jobs'})
        public = {'/api/jobs':('jobs',None), '/api/reviews':('reviews',None),
                  '/api/candidates':('candidates',PUBLIC_CANDIDATE_FIELDS)}
        if path in public:
            table, allowed = public[path]
            cols = '*' if allowed is None else ','.join(allowed)
            with db_connection() as db:
                rows = db.execute(f'SELECT {cols} FROM {table} WHERE status=? ORDER BY createdAt DESC LIMIT 500',('approved',)).fetchall()
            output = [dict(row) for row in rows]
            if table == 'jobs':
                output = [r for r in output if not r.get('deadline') or r['deadline'] >= datetime.now(timezone.utc).strftime('%Y-%m-%d')]
            return self.send_json(200,{table:output})
        if path.startswith('/api/admin/'):
            if not self.authorized():
                return self.send_json(401,{'error':'Invalid administrator key.'})
            table = path.split('/')[-1]
            if table not in ('jobs','candidates','reviews','reports','alerts'):
                return self.send_json(404,{'error':'Unknown endpoint.'})
            with db_connection() as db:
                rows = db.execute(f'SELECT * FROM {table} ORDER BY createdAt DESC LIMIT 1000').fetchall()
            return self.send_json(200,{table:[dict(r) for r in rows]})
        if path == '/jobs.rss':
            with db_connection() as db:
                rows = db.execute("SELECT id,title,company,location,description,createdAt FROM jobs WHERE status=? AND (deadline IS NULL OR deadline='' OR deadline>=?) ORDER BY createdAt DESC LIMIT 100",('approved',datetime.now(timezone.utc).strftime('%Y-%m-%d'))).fetchall()
            items = ''.join('<item><title>'+html.escape(r['title']+' — '+r['company'])+'</title><guid>'+html.escape(r['id'])+'</guid><link>https://prowelljobs.com/#jobs</link><description>'+html.escape((r['description'] or '')[:500])+'</description></item>' for r in rows)
            body = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Prowell Jobs openings</title><link>https://prowelljobs.com/</link><description>New approved opportunities</description>'+items+'</channel></rss>').encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type','application/rss+xml; charset=utf-8')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith('/api/'):
            return self.send_json(404,{'error':'Unknown endpoint.'})
        allowed = {'/','/index.html','/styles.css','/app.js','/admin.html','/admin.js','/favicon.svg','/robots.txt','/sitemap.xml'}
        if path not in allowed and not (path.startswith('/assets/') and path.endswith(('.svg','.png','.jpg','.webp')) and '..' not in path):
            return self.send_json(404,{'error':'File not found.'})
        if path == '/':
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        validators = {'/api/jobs':('jobs',validate_job),'/api/candidates':('candidates',validate_candidate),
                      '/api/reviews':('reviews',validate_review),'/api/reports':('reports',validate_report),
                      '/api/alerts':('alerts',validate_alert)}
        if path not in validators:
            return self.send_json(404,{'error':'Unknown endpoint.'})
        table,validate = validators[path]
        try:
            raw = self.json_body()
            result = validate(raw)
            obj, withdrawal = result if table == 'candidates' else (result,None)
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        if not check_rate(self.client_address[0],table,4 if table != 'jobs' else 6):
            return self.send_json(429,{'error':'Too many submissions; try again later.'})
        cols = list(obj)
        with db_connection() as db:
            db.execute(f'INSERT INTO {table} ({",".join(cols)}) VALUES ({",".join("?" for _ in cols)})',list(obj.values()))
        response = {'message':'Submitted for review. It will not appear publicly until approved.','id':obj['id']}
        if withdrawal:
            response['withdrawalCode'] = withdrawal
            response['message'] = 'Candidate profile received for review. Save your private withdrawal code.'
        if table == 'alerts':
            response['message'] = 'Saved your interest in future email alerts. Automated email delivery is not enabled yet; use RSS for live alerts.'
        return self.send_json(201,response)

    def do_PATCH(self):
        path = urlsplit(self.path).path
        parts = path.split('/')
        if len(parts) != 5 or parts[:3] != ['','api','admin'] or parts[3] not in ('jobs','candidates','reviews','reports'):
            return self.send_json(404,{'error':'Unknown endpoint.'})
        if not self.authorized():
            return self.send_json(401,{'error':'Invalid administrator key.'})
        try:
            uuid.UUID(parts[4])
            data = self.json_body()
            if not isinstance(data,dict) or data.get('status') not in STATUS_VALUES:
                raise ValueError('Choose pending, approved, or rejected.')
            if 'verified' in data and (parts[3] != 'jobs' or type(data['verified']) is not bool):
                raise ValueError('Verified may be set only for jobs.')
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            if parts[3] == 'jobs' and 'verified' in data:
                done = db.execute('UPDATE jobs SET status=?,verified=? WHERE id=?',
                                  (data['status'],int(data['verified']),parts[4]))
            else:
                done = db.execute(f'UPDATE {parts[3]} SET status=? WHERE id=?',(data['status'],parts[4]))
        return self.send_json(200,{'message':'Updated.'}) if done.rowcount else self.send_json(404,{'error':'Record not found.'})

    def do_DELETE(self):
        path = urlsplit(self.path).path
        parts = path.split('/')
        if len(parts) != 4 or parts[:3] != ['','api','candidates']:
            return self.send_json(404,{'error':'Unknown endpoint.'})
        try:
            uuid.UUID(parts[3])
            payload = self.json_body()
            code = field(payload,'withdrawalCode',150,True)
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            row = db.execute('SELECT withdrawalHash FROM candidates WHERE id=?',(parts[3],)).fetchone()
            if not row or not hmac.compare_digest(row['withdrawalHash'],hashlib.sha256(code.encode()).hexdigest()):
                return self.send_json(403,{'error':'Invalid profile ID or withdrawal code.'})
            db.execute('DELETE FROM candidates WHERE id=?',(parts[3],))
        return self.send_json(200,{'message':'Your profile has been withdrawn and deleted.'})

    def do_HEAD(self):
        if urlsplit(self.path).path in {'/','/index.html','/favicon.svg','/robots.txt','/sitemap.xml'}:
            super().do_HEAD()
        else:
            self.send_response(405)
            self.end_headers()


if __name__ == '__main__':
    initialize_db()
    server = ThreadingHTTPServer(('0.0.0.0',PORT),Handler)
    print(f'[Prowell Jobs] Running at http://localhost:{PORT}',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
