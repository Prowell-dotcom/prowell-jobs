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
from datetime import datetime, timezone, timedelta
from http.cookies import SimpleCookie, CookieError
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from notifications import email_configured, sms_configured, send_notification, NotificationDeliveryError
from accounts import password_hash, verify_password, SESSION_SECONDS, COOKIE_NAME
from writing_marketplace import Marketplace, init_db as init_writing_db
import admin_document_sender as admin_docs
import admin_extension_store as owner_extension
import good_writers_reporting as good_writers_reports
import admin_paraphraser

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
ADMIN_SESSION_SECONDS = 7 * 24 * 60 * 60
ADMIN_SESSION_COOKIE = "prowell_admin_session"
ADMIN_KEY_FINGERPRINT = hashlib.sha256(ADMIN_KEY.encode()).hexdigest()
MEMBER_LOGIN_REQUIRED = os.getenv('MEMBER_LOGIN_REQUIRED', '1') != '0'
WRITING_UPLOAD_ROOT = Path(os.getenv('WRITING_UPLOAD_DIR', str(DATABASE_PATH.parent / 'writing-private-files' if DATABASE_PATH.parent != ROOT else ROOT.parent / 'prowell-private-writing-files'))).resolve()
if WRITING_UPLOAD_ROOT == ROOT or ROOT in WRITING_UPLOAD_ROOT.parents:
    raise RuntimeError('WRITING_UPLOAD_DIR must be outside the public site directory.')
MEMBER_EMAIL_VERIFICATION_REQUIRED = os.getenv('MEMBER_EMAIL_VERIFICATION_REQUIRED', '1') == '1'

# Moderation badges indicate unseen submissions, not pending or total records.
ADMIN_TABS = ('jobs', 'applications', 'candidates', 'reviews', 'reports', 'alerts', 'notification_outbox')

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
            ('phone','TEXT'), ('verified','INTEGER NOT NULL DEFAULT 0'),
            ('notifyEmail','TEXT'), ('notifyPhone','TEXT'), ('notifyConsent','INTEGER NOT NULL DEFAULT 0')
        ):
            if column not in cols:
                db.execute(f'ALTER TABLE jobs ADD COLUMN {column} {sqltype}')
        db.execute('''CREATE TABLE IF NOT EXISTS notification_outbox (
            eventId TEXT PRIMARY KEY, jobId TEXT NOT NULL, kind TEXT NOT NULL,
            channel TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL,
            body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt REAL NOT NULL DEFAULT 0,
            lastError TEXT, createdAt TEXT NOT NULL, sentAt TEXT)''')
        db.execute('''CREATE TABLE IF NOT EXISTS admin_sessions (
            tokenHash TEXT PRIMARY KEY, csrfToken TEXT NOT NULL,
            createdAt TEXT NOT NULL, expiresAt REAL NOT NULL,
            keyFingerprint TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS admin_tab_views (
            section TEXT PRIMARY KEY, seenAt TEXT NOT NULL)''')
        # Singleton owner: unique fixed primary key makes administrator setup one-time.
        db.execute('''CREATE TABLE IF NOT EXISTS admin_owner (
            id INTEGER PRIMARY KEY CHECK (id=1), email TEXT COLLATE NOCASE NOT NULL UNIQUE,
            fullName TEXT NOT NULL, passwordSalt TEXT NOT NULL,
            passwordHash TEXT NOT NULL, createdAt TEXT NOT NULL)''')
        # Password recovery for the existing sole administrator. This never creates another owner.
        owner_cols = {r['name'] for r in db.execute('PRAGMA table_info(admin_owner)')}
        for col, kind in (('recoveryHash','TEXT'), ('recoveryExpires','REAL'), ('recoveryRequestedAt','REAL')):
            if col not in owner_cols:
                db.execute(f'ALTER TABLE admin_owner ADD COLUMN {col} {kind}')
        db.execute('CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expiresAt)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_notifications_retry ON notification_outbox(status,nextAttemptAt)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, createdAt DESC)')
        db.execute('''CREATE TABLE IF NOT EXISTS candidates (
            id TEXT PRIMARY KEY,alias TEXT NOT NULL,category TEXT NOT NULL,country TEXT NOT NULL,
            city TEXT,skills TEXT NOT NULL,experience TEXT NOT NULL,availability TEXT NOT NULL,
            summary TEXT NOT NULL,currency TEXT,payExpectation TEXT,
            email TEXT NOT NULL,phone TEXT,consent INTEGER NOT NULL,
            withdrawalHash TEXT NOT NULL,createdAt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending')''')
        db.execute('''CREATE TABLE IF NOT EXISTS applications (
            id TEXT PRIMARY KEY,jobId TEXT NOT NULL,jobTitle TEXT NOT NULL,
            employerName TEXT NOT NULL,fullName TEXT NOT NULL,email TEXT,phone TEXT,
            country TEXT,city TEXT,experience TEXT NOT NULL,message TEXT NOT NULL,
            consent INTEGER NOT NULL,withdrawalHash TEXT NOT NULL,
            createdAt TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending')''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(createdAt DESC)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(jobId)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status, createdAt DESC)')
        db.execute('''CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,name TEXT NOT NULL,relationship TEXT NOT NULL,kind TEXT NOT NULL,
            rating INTEGER,comment TEXT NOT NULL,createdAt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending')''')
        # Additive migration: contact details for private feedback receipts must never be public.
        review_columns = {r['name'] for r in db.execute('PRAGMA table_info(reviews)')}
        for name, field_type in (
            ('notifyEmail', 'TEXT'),
            ('notifyConsent', 'INTEGER NOT NULL DEFAULT 0'),
        ):
            if name not in review_columns:
                db.execute(f'ALTER TABLE reviews ADD COLUMN {name} {field_type}')
        db.execute('''CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,subject TEXT NOT NULL,details TEXT NOT NULL,email TEXT,
            createdAt TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending')''')
        db.execute('''CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,email TEXT NOT NULL,category TEXT,country TEXT,
            consent INTEGER NOT NULL,createdAt TEXT NOT NULL)''')
        # Free accounts: additive schema; existing Railway records remain intact.
        db.execute('''CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,
            fullName TEXT NOT NULL,role TEXT NOT NULL,phone TEXT,
            passwordSalt TEXT NOT NULL,passwordHash TEXT NOT NULL,
            emailVerified INTEGER NOT NULL DEFAULT 0,
            verificationHash TEXT, verificationExpires REAL,
            createdAt TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS member_sessions (
            tokenHash TEXT PRIMARY KEY,memberId TEXT NOT NULL,
            csrfToken TEXT NOT NULL,createdAt TEXT NOT NULL,expiresAt REAL NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_member_sessions_exp ON member_sessions(expiresAt)')
        member_cols={r['name'] for r in db.execute('PRAGMA table_info(members)')}
        for col, sqltype in (('recoveryHash','TEXT'),('recoveryExpires','REAL')):
            if col not in member_cols:
                db.execute(f'ALTER TABLE members ADD COLUMN {col} {sqltype}')
        for table in ('jobs','applications','candidates'):
            cols={r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
            if 'memberId' not in cols:
                db.execute(f'ALTER TABLE {table} ADD COLUMN memberId TEXT')
            db.execute(f'CREATE INDEX IF NOT EXISTS idx_{table}_member ON {table}(memberId)')
        init_writing_db(db)



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
    wants_notice = payload.get('notifyConsent') is True
    obj['notifyConsent'] = int(wants_notice)
    obj['notifyEmail'] = checked_email(field(payload, 'notifyEmail', 180)) if wants_notice else ''
    obj['notifyPhone'] = field(payload, 'notifyPhone', 30) if wants_notice else ''
    if wants_notice and not (obj['notifyEmail'] or obj['notifyPhone']):
        raise ValueError('Provide an email address or SMS number for employer notifications.')
    if obj['notifyPhone'] and not re.fullmatch(r'\+[1-9]\d{7,14}', obj['notifyPhone']):
        raise ValueError('SMS number must use international format, e.g. +254703772555.')
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


def validate_application(payload):
    """Validate applications against approved, unexpired vacancies only."""
    if not isinstance(payload, dict):
        raise ValueError('Invalid application.')
    require_consent(payload)
    job_id = field(payload, 'jobId', 70, True)
    try:
        uuid.UUID(job_id)
    except ValueError as exc:
        raise ValueError('Choose an active job listing before applying.') from exc
    with db_connection() as db:
        job = db.execute('SELECT id,title,company,deadline,status FROM jobs WHERE id=?', (job_id,)).fetchone()
    if not job or job['status'] != 'approved' or (job['deadline'] and job['deadline'] < datetime.now(timezone.utc).strftime('%Y-%m-%d')):
        raise ValueError('This vacancy is no longer accepting applications.')
    obj = {name: field(payload, name, length, required) for name,length,required in (
        ('fullName',120,True),('email',180,False),('phone',45,False),
        ('country',90,False),('city',90,False),('experience',120,True),('message',2500,True)
    )}
    checked_email(obj['email'])
    if not obj['email'] and not obj['phone']:
        raise ValueError('Add an email address or phone number so Prowell Jobs can contact you.')
    if len(obj['message']) < 20:
        raise ValueError('Tell us about your relevant skills in at least 20 characters.')
    code = secrets.token_urlsafe(24)
    obj.update(id=str(uuid.uuid4()), jobId=job_id, jobTitle=job['title'], employerName=job['company'],
               consent=1, withdrawalHash=hashlib.sha256(code.encode()).hexdigest(),
               createdAt=timestamp(), status='pending')
    return obj, code


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
    obj['notifyConsent'] = int(payload.get('notifyConsent') is True)
    obj['notifyEmail'] = checked_email(field(payload, 'notifyEmail', 180)) if obj['notifyConsent'] else ''
    if obj['notifyConsent'] and not obj['notifyEmail']:
        raise ValueError('Enter an email address to receive a feedback confirmation.')
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
PUBLIC_REVIEW_FIELDS = ('id','name','relationship','kind','rating','comment','createdAt')


# Transactional notices are saved to SQLite first. A worker retries temporary provider failures.
# No real emails or SMS are sent until the corresponding Railway credentials are configured.
notification_wake = threading.Event()

def queue_job_notices(db, job, event):
    # event: submitted, approved, or rejected; never include applicant personal details.
    title = (job['title'] or 'a vacancy').replace('\n', ' ')[:100]
    company = (job['company'] or 'Employer').replace('\n', ' ')[:100]
    ref = job['id'][:8]
    if event == 'submitted':
        subject = f'Prowell Jobs: job submitted for review ({ref})'
        body = (f'Your vacancy "{title}" for {company} has been received by Prowell Jobs.\n'
                f'Reference: {ref}\nStatus: Pending administrator review.\n'
                'We will notify you if the listing is approved or rejected.\n'
                'Do not pay anyone who claims they can guarantee approval.')
    elif event == 'approved':
        subject = f'Prowell Jobs: vacancy approved ({ref})'
        body = f'Your vacancy "{title}" has been approved and is now visible at https://prowelljobs.com/.\nReference: {ref}'
    else:
        subject = f'Prowell Jobs: vacancy not approved ({ref})'
        body = f'Your vacancy "{title}" was not approved for publication.\nReference: {ref}\nContact prowellofficial@gmail.com for questions.'

    items=[]
    if event == 'submitted':
        admin_email = os.getenv('ADMIN_NOTIFICATION_EMAIL', 'prowellofficial@gmail.com').strip()
        admin_sms = os.getenv('ADMIN_NOTIFICATION_PHONE','').strip()
        admin_subject = f'Action required: new Prowell Jobs vacancy - {title} ({ref})'
        admin_body = (f'New vacancy awaiting administrator review: {title} for {company}.\n'
                      f'Reference: {ref}\nReview securely at https://prowelljobs.com/admin.html\n'
                      'Do not disclose your administrator key.')
        # Preserve an admin alert even while Resend is unavailable.
        if not email_valid(admin_email):
            print('[Prowell notifications] Invalid ADMIN_NOTIFICATION_EMAIL; using Prowell official inbox.',flush=True)
            admin_email='prowellofficial@gmail.com'
        items.append(('admin','email',admin_email,admin_subject,admin_body))
        if sms_configured() and re.fullmatch(r'\+[1-9]\d{7,14}',admin_sms):
            items.append(('admin','sms',admin_sms,admin_subject,admin_body))

    if job['notifyConsent']:
        if job['notifyEmail']:
            # Save the acknowledgment even if Resend is temporarily unavailable.
            # The private outbox can retry after configuration is restored.
            items.append(('employer','email',job['notifyEmail'],subject,body))
        if sms_configured() and job['notifyPhone']:
            items.append(('employer','sms',job['notifyPhone'],subject,body))
    for audience, channel, recipient, subj, msg in items:
        event_id=f'job:{job["id"]}:{event}:{audience}:{channel}'
        if channel=='sms':
            msg=('Prowell Jobs: '+ ('New job review requested' if audience=='admin' else
                 ('Job submitted for review' if event=='submitted' else 'Job approved' if event=='approved' else 'Job not approved'))
                 + f'. Ref {ref}. '+ ('Check admin dashboard.' if audience=='admin' else 'See your email or contact Prowell Jobs.'))
        db.execute('''INSERT OR IGNORE INTO notification_outbox
            (eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
            VALUES (?,?,?,?,?,?,?,'pending',?)''',
            (event_id,job['id'],event,channel,recipient,subj,msg,timestamp()))
    return len(items)


def deliver_job_emails_now(job_id, event):
    """Attempt queued job emails before returning; leave failures for retry.

    An administrator alert and an opted-in employer acknowledgment are separate
    outbox items. Their stable IDs prevent repeated sends on re-submission.
    """
    audiences = ('admin', 'employer') if event == 'submitted' else ('employer',)
    for audience in audiences:
        # If no employer email was supplied/consented to, no such row exists.
        deliver_notification_event(f'job:{job_id}:{event}:{audience}:email')



def queue_request_notices(db, table, record, event='submitted'):
    """Queue private transactional receipts + admin alerts for existing website forms.

    These are acknowledgements, not hiring offers or promises of publication.
    Never email withdrawal codes, jobseeker contact details, or report narratives.
    """
    reference = record['id'][:8]
    kinds = {
        'applications': 'job application',
        'candidates': 'candidate profile',
        'reviews': 'review or comment',
        'reports': 'confidential safety report',
        'alerts': 'job-alert interest',
    }
    if table not in kinds:
        return []
    label = kinds[table]
    email = ''
    if table in ('applications', 'candidates', 'reports', 'alerts'):
        email = (record['email'] or '').strip()
    elif table == 'reviews' and record['notifyConsent']:
        email = (record['notifyEmail'] or '').strip()
    if not email_valid(email):
        email = ''

    if event == 'submitted':
        admin_subject = f'Prowell Jobs: new {label} requires review ({reference})'
        admin_body = (f'A new {label} was submitted to Prowell Jobs.\n'
                      f'Reference: {reference}\n'
                      'Review it securely at https://prowelljobs.com/admin.html\n'
                      "Do not send applicants' private information to unverified employers.")
        if table == 'applications':
            context = f' for the job "{record["jobTitle"]}"'
            subject = f'Prowell Jobs: application received ({reference})'
            receipt = (f'We received your application{context}.\n'
                       'It is in private review by the Prowell Jobs team, not automatically sent to an employer.\n'
                       'This is not a job offer or confirmation of selection.')
        elif table == 'candidates':
            subject = f'Prowell Jobs: skills profile received ({reference})'
            receipt = ('We received your candidate skills profile for moderation.\n'
                       'It is not public until approved; your email and phone are not published.')
        elif table == 'reviews':
            subject = f'Prowell Jobs: feedback received ({reference})'
            receipt = 'Thank you for sending feedback. Your review or comment awaits moderation before publication.'
        elif table == 'reports':
            subject = f'Prowell Jobs: confidential report received ({reference})'
            receipt = ('Thank you for raising a concern. The Prowell Jobs team has received it for private review.\n'
                       'We may contact you for additional details; no specific outcome is guaranteed.')
        else:  # alerts
            subject = f'Prowell Jobs: alert interest registered ({reference})'
            receipt = ('We have recorded your interest in future job email alerts.\n'
                       'Automated vacancy-alert subscriptions are not active yet.\n'
                       'You can currently follow https://prowelljobs.com/jobs.rss')
        receipt += (f'\nReference: {reference}\n'
                    'Keep your private withdrawal code from the website safe, if one was provided.\n'
                    'Questions? Contact prowellofficial@gmail.com')
        recipients = [('admin', os.getenv('ADMIN_NOTIFICATION_EMAIL', 'prowellofficial@gmail.com').strip(),
                       admin_subject, admin_body)]
        if email:
            recipients.append(('submitter', email, subject, receipt))
    else:
        if not email:
            return []
        if table == 'applications' and event in ('reviewed', 'closed'):
            subject = f'Prowell Jobs: application status updated ({reference})'
            text = ('Our team has marked your application as reviewed.' if event == 'reviewed' else
                    'Our team has closed the application review record.')
            text += (' This does not mean an employer has hired or rejected you. Contact Prowell Jobs for more information.')
        elif table == 'candidates' and event in ('approved', 'rejected'):
            subject = f'Prowell Jobs: candidate profile update ({reference})'
            text = ('Your candidate preview has been approved for public display.' if event == 'approved' else
                    'Your candidate preview was not approved for public display.')
            text += ' Your private contact details remain hidden from the public.'
        elif table == 'reviews' and event in ('approved', 'rejected'):
            subject = f'Prowell Jobs: feedback moderation update ({reference})'
            text = ('Your review or comment has been approved for publication.' if event == 'approved' else
                    'Your review or comment was not approved for public display.')
        elif table == 'reports' and event in ('approved', 'rejected'):
            subject = f'Prowell Jobs: safety report update ({reference})'
            text = ('The team has reviewed your confidential safety report. This status is not a guarantee that '
                    'an investigation or enforcement action has been completed.')
        else:
            return []
        recipients = [('submitter', email, subject, text + f'\nReference: {reference}\nContact prowellofficial@gmail.com')]

    ids = []
    for audience, recipient, subject, body in recipients:
        if not email_valid(recipient):
            continue
        event_id = f'{table}:{record["id"]}:{event}:{audience}:email'
        db.execute("INSERT OR IGNORE INTO notification_outbox "
                   "(eventId,jobId,kind,channel,recipient,subject,body,status,createdAt) "
                   "VALUES (?,?,?,?,?,?,?,'pending',?)",
            (event_id,record['id'],f'{table}_{event}_{audience}','email',recipient,subject,body,timestamp()))
        ids.append(event_id)
    return ids


def deliver_notification_event(event_id):
    """Claim and attempt an alert immediately; failed attempts remain queued."""
    now = time.time()
    with db_connection() as db:
        row = db.execute('''SELECT * FROM notification_outbox WHERE eventId=?
            AND attempts<4 AND nextAttemptAt<=?
            AND status IN ('pending','retry','sending')''', (event_id, now)).fetchone()
        if row is None:
            return None
        claim = db.execute('''UPDATE notification_outbox
            SET status='sending',nextAttemptAt=?
            WHERE eventId=? AND attempts<4 AND nextAttemptAt<=?
            AND status IN ('pending','retry','sending')''', (now+90, event_id, now))
        if claim.rowcount != 1:
            return None
    try:
        send_notification(row['channel'],row['recipient'],row['subject'],row['body'],row['eventId'])
        status='sent'; last_error=None; sent_at=timestamp(); retry_at=0
    except Exception as exc:
        attempts=row['attempts']+1
        status='failed' if attempts >= 4 else 'retry'
        # Never expose the provider response body, addresses, or API secrets.
        last_error=(str(exc) if isinstance(exc, NotificationDeliveryError) else type(exc).__name__)[:130]
        retry_at=time.time()+min(900,30*2**(attempts-1))
        sent_at=None
        print(f'[Prowell notifications] {row["kind"]} {row["channel"]}: '
              f'{last_error} (attempt {attempts}; {status})',flush=True)
    with db_connection() as db:
        db.execute('''UPDATE notification_outbox SET status=?,attempts=attempts+1,
            nextAttemptAt=?,lastError=?,sentAt=?
            WHERE eventId=? AND status='sending' ''',
            (status,retry_at,last_error,sent_at,event_id))
    return status


def process_notification_outbox(max_batch=10):
    """Retry queued messages and recover interrupted delivery attempts."""
    with db_connection() as db:
        event_ids=[r['eventId'] for r in db.execute('''SELECT eventId FROM notification_outbox
            WHERE status IN ('pending','retry','sending') AND attempts<4 AND nextAttemptAt<=?
            ORDER BY createdAt LIMIT ?''',(time.time(),max_batch))]
    return sum(deliver_notification_event(event_id) is not None for event_id in event_ids)

def notification_loop():
    while True:
        notification_wake.wait(timeout=30)
        notification_wake.clear()
        try: process_notification_outbox()
        except Exception as exc:
            print('[Prowell notifications] Worker error:',type(exc).__name__,flush=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()')
        super().end_headers()

    def send_json(self,status,payload,extra_headers=None):
        data = json.dumps(payload,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def admin_owner_exists(self):
        with db_connection() as db:
            return db.execute('SELECT 1 FROM admin_owner WHERE id=1').fetchone() is not None

    def _bearer_authorized(self):
        # Legacy Railway ADMIN_KEY access works only before the sole owner is created.
        # After bootstrap, use the owner's password-authenticated cookie session.
        return (not self.admin_owner_exists() and
                hmac.compare_digest(self.headers.get('Authorization', ''), f'Bearer {ADMIN_KEY}'))

    def admin_session(self):
        try:
            cookies = SimpleCookie()
            cookies.load(self.headers.get('Cookie', ''))
            session_cookie = cookies.get(ADMIN_SESSION_COOKIE)
            token = session_cookie.value if session_cookie else ''
        except (CookieError, ValueError):
            return None
        if not token or len(token) > 150:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with db_connection() as db:
            row = db.execute('''SELECT csrfToken,expiresAt,keyFingerprint
                FROM admin_sessions WHERE tokenHash=?''', (token_hash,)).fetchone()
        if not row or row['expiresAt'] <= time.time() or not hmac.compare_digest(row['keyFingerprint'], ADMIN_KEY_FINGERPRINT):
            return None
        return {'tokenHash': token_hash, 'csrfToken': row['csrfToken'], 'expiresAt': row['expiresAt']}

    def authorized(self):
        return self._bearer_authorized() or self.admin_session() is not None

    def admin_write_authorized(self):
        if self._bearer_authorized():
            return True
        session = self.admin_session()
        csrf = self.headers.get('X-Admin-CSRF', '')
        return bool(session and csrf and hmac.compare_digest(csrf, session['csrfToken']))

    def session_cookie(self, token='', clear=False):
        # Use Secure cookies behind Railway's HTTPS reverse proxy. Local HTTP tests stay usable.
        secure = bool(os.getenv('RAILWAY_ENVIRONMENT') or self.headers.get('X-Forwarded-Proto', '').lower() == 'https')
        value = f'{ADMIN_SESSION_COOKIE}={token}; Path=/api/admin; HttpOnly; SameSite=Strict'
        if secure:
            value += '; Secure'
        if clear:
            value += '; Max-Age=0'
        else:
            value += f'; Max-Age={ADMIN_SESSION_SECONDS}'
        return value

    def _issue_admin_session(self):
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        expiry = time.time() + ADMIN_SESSION_SECONDS
        with db_connection() as db:
            db.execute('DELETE FROM admin_sessions WHERE expiresAt < ? OR keyFingerprint != ?',
                       (time.time(), ADMIN_KEY_FINGERPRINT))
            db.execute('''INSERT INTO admin_sessions(tokenHash,csrfToken,createdAt,expiresAt,keyFingerprint)
                VALUES (?,?,?,?,?)''', (hashlib.sha256(token.encode()).hexdigest(),
                                        csrf, timestamp(), expiry, ADMIN_KEY_FINGERPRINT))
        return self.send_json(200, {'authenticated': True, 'csrfToken': csrf, 'expiresAt': expiry},
                              {'Set-Cookie': self.session_cookie(token)})

    def admin_bootstrap(self):
        # Private, one-time owner provisioning. Nothing in member signup can create admins.
        if not check_rate(self.client_address[0], 'admin-owner-setup', 5):
            return self.send_json(429, {'error': 'Too many administrator setup attempts.'})
        if self.admin_owner_exists():
            return self.send_json(409, {'error': 'Administrator registration is permanently closed. Please sign in.'})
        try:
            payload = self.json_body()
            setup_key = payload.get('setupKey', '')
            email = checked_email(field(payload, 'email', 180, True), True).lower()
            name = field(payload, 'fullName', 120, True)
            password = payload.get('password')
            confirm = payload.get('confirmPassword')
            if not isinstance(setup_key, str) or not hmac.compare_digest(setup_key, ADMIN_KEY):
                return self.send_json(401, {'error': 'Administrator setup authorization failed.'})
            if not isinstance(password, str) or not 12 <= len(password) <= 128:
                raise ValueError('Administrator password must contain 12–128 characters.')
            if password != confirm:
                raise ValueError('Administrator passwords do not match.')
            if len(name) < 2:
                raise ValueError('Enter the administrator account name.')
        except ValueError as exc:
            return self.send_json(400, {'error': str(exc)})
        salt, digest = password_hash(password)
        try:
            with db_connection() as db:
                db.execute('''INSERT INTO admin_owner
                    (id,email,fullName,passwordSalt,passwordHash,createdAt)
                    VALUES (1,?,?,?,?,?)''', (email,name,salt,digest,timestamp()))
                # Any previously issued setup-key admin cookies are invalidated.
                db.execute('DELETE FROM admin_sessions')
        except sqlite3.IntegrityError:
            return self.send_json(409, {'error': 'Administrator account already created.'})
        return self._issue_admin_session()

    def admin_login(self):
        if not check_rate(self.client_address[0], 'admin-login', 8):
            return self.send_json(429, {'error': 'Too many login attempts; try again later.'})
        try:
            payload = self.json_body()
            if not isinstance(payload, dict):
                raise ValueError('Invalid sign-in request.')
        except ValueError as error:
            return self.send_json(400, {'error': str(error)})
        with db_connection() as db:
            owner = db.execute('SELECT email,passwordSalt,passwordHash FROM admin_owner WHERE id=1').fetchone()
        if owner:
            email = payload.get('email', '')
            password = payload.get('password', '')
            if (not isinstance(email, str) or not isinstance(password, str) or
                not hmac.compare_digest(email.strip().lower(), owner['email'].lower()) or
                not verify_password(password, owner['passwordSalt'], owner['passwordHash'])):
                return self.send_json(401, {'error': 'Incorrect administrator credentials.'})
        else:
            # Existing Railway ADMIN_KEY remains a setup-time fallback only.
            key = payload.get('adminKey', '')
            if not isinstance(key, str) or not hmac.compare_digest(key, ADMIN_KEY):
                return self.send_json(401, {'error': 'Set up the owner account with your private ADMIN_KEY first.'})
        return self._issue_admin_session()

    def admin_logout(self):
        session = self.admin_session()
        if session and not self.admin_write_authorized():
            return self.send_json(403, {'error': 'Session validation failed.'})
        if session:
            with db_connection() as db:
                db.execute('DELETE FROM admin_sessions WHERE tokenHash=?', (session['tokenHash'],))
        return self.send_json(200, {'authenticated': False, 'message': 'Signed out.'},
                              {'Set-Cookie': self.session_cookie(clear=True)})

    def admin_recovery_start(self):
        # Password recovery by pre-existing owner email only; no second admin setup.
        if not check_rate(self.client_address[0], 'admin-recovery-request', 5):
            return self.send_json(429, {'error': 'Too many recovery attempts. Please try later.'})
        try:
            data = self.json_body()
            email = checked_email(field(data, 'email', 180, True), True).lower()
        except ValueError as exc:
            return self.send_json(400, {'error': str(exc)})
        event_id = None
        if email_configured():
            with db_connection() as db:
                owner = db.execute('SELECT email,recoveryRequestedAt FROM admin_owner WHERE id=1').fetchone()
                if (owner and hmac.compare_digest(owner['email'].lower(), email)
                        and (not owner['recoveryRequestedAt'] or owner['recoveryRequestedAt'] < time.time()-300)):
                    token = secrets.token_urlsafe(32)
                    db.execute('UPDATE admin_owner SET recoveryHash=?,recoveryExpires=?,recoveryRequestedAt=? WHERE id=1',
                               (hashlib.sha256(token.encode()).hexdigest(),time.time()+1800,time.time()))
                    event_id = 'admin:owner:recovery:'+uuid.uuid4().hex
                    url = 'https://prowelljobs.com/account.html?mode=admin&adminReset='+token
                    db.execute('''INSERT INTO notification_outbox(eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
                        VALUES(?,?,?,?,?,?,?,'pending',?)''',
                        (event_id,'admin-owner','admin_recovery','email',owner['email'],
                         'Reset your Prowell Jobs administrator password',
                         'If you requested an administrator password reset, use this one-time link within 30 minutes:\n'+url+
                         '\nIf you did not request it, ignore this message.',timestamp()))
        if event_id:
            deliver_notification_event(event_id)
            notification_wake.set()
        return self.send_json(200, {'message':'If the owner email matches an existing account, a 30-minute reset link will be sent.'})

    def admin_recovery_complete(self):
        if not check_rate(self.client_address[0], 'admin-recovery-complete', 12):
            return self.send_json(429, {'error': 'Too many reset attempts.'})
        try:
            data = self.json_body()
            token = field(data,'token',180,True)
            password = data.get('password')
            if len(token)<25 or not isinstance(password,str) or not 12<=len(password)<=128:
                raise ValueError('Invalid reset link or password. Use at least 12 characters.')
            if password != data.get('confirmPassword'):
                raise ValueError('Passwords do not match.')
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        salt,digest=password_hash(password)
        with db_connection() as db:
            owner=db.execute('SELECT recoveryHash,recoveryExpires FROM admin_owner WHERE id=1').fetchone()
            if (not owner or not owner['recoveryHash'] or not owner['recoveryExpires']
                    or owner['recoveryExpires']<=time.time()
                    or not hmac.compare_digest(owner['recoveryHash'],hashlib.sha256(token.encode()).hexdigest())):
                return self.send_json(400,{'error':'This password-reset link is invalid or expired.'})
            db.execute('''UPDATE admin_owner SET passwordSalt=?,passwordHash=?,recoveryHash=NULL,recoveryExpires=NULL
                WHERE id=1''',(salt,digest))
            db.execute('DELETE FROM admin_sessions')
        return self.send_json(200,{'message':'Administrator password updated. Sign in with your new password.'},
                              {'Set-Cookie':self.session_cookie(clear=True)})

    def admin_unread_counts(self):
        # These counts are private. Each section has an independent, persistent last-viewed time.
        # An existing pending record is not "new" again simply because it wasn't approved.
        with db_connection() as db:
            views = {r['section']: r['seenAt'] for r in db.execute(
                'SELECT section,seenAt FROM admin_tab_views')}
            totals = {}
            for section in ADMIN_TABS:
                cutoff = views.get(section, '')
                totals[section] = db.execute(
                    f'SELECT COUNT(*) FROM {section} WHERE createdAt > ?',
                    (cutoff,)).fetchone()[0]
                if section == 'notification_outbox':
                    owner_extension.ensure_report_tables(db)
                    good_writers_reports._tables(db)
                    totals[section] += db.execute(
                        'SELECT COUNT(*) FROM extension_claim_events WHERE created_at > ?',
                        (cutoff,)).fetchone()[0]
                    totals[section] += db.execute(
                        'SELECT COUNT(*) FROM good_writers_claim_events WHERE created_at > ?',
                        (cutoff,)).fetchone()[0]
        return {'unread': totals}

    def mark_admin_tab_viewed(self):
        if not self.authorized():
            return self.send_json(401, {'error': 'Sign in as administrator.'})
        if not self.admin_write_authorized():
            return self.send_json(403, {'error': 'Invalid session validation token.'})
        try:
            body = self.json_body()
            section = body.get('section') if isinstance(body, dict) else None
            if section not in ADMIN_TABS:
                raise ValueError('Invalid moderation section.')
        except ValueError as exc:
            return self.send_json(400, {'error': str(exc)})
        viewed_at = timestamp()
        with db_connection() as db:
            db.execute('''INSERT INTO admin_tab_views(section,seenAt) VALUES (?,?)
                ON CONFLICT(section) DO UPDATE SET seenAt =
                CASE WHEN admin_tab_views.seenAt < excluded.seenAt
                THEN excluded.seenAt ELSE admin_tab_views.seenAt END''',
                (section, viewed_at))
        return self.send_json(200, {'section': section, 'unread': 0})

    def notification_diagnostics(self):
        recipient = os.getenv('ADMIN_NOTIFICATION_EMAIL', 'prowellofficial@gmail.com').strip()
        sender = os.getenv('NOTIFY_FROM_EMAIL', '').strip()
        with db_connection() as db:
            total_jobs = db.execute('SELECT COUNT(*) AS n FROM jobs').fetchone()['n']
            last_job = db.execute('SELECT createdAt FROM jobs ORDER BY createdAt DESC LIMIT 1').fetchone()
            totals = {r['status']: r['n'] for r in db.execute('''SELECT status,COUNT(*) AS n
                FROM notification_outbox GROUP BY status''')}
        return {'emailConfigured': email_configured(),
                'senderConfigured': email_valid(sender),
                'adminRecipientConfigured': email_valid(recipient),
                'adminRecipient': recipient if email_valid(recipient) else 'Invalid or missing',
                'jobCount': total_jobs, 'lastJobCreatedAt': last_job['createdAt'] if last_job else None,
                'notificationCounts': totals,
                'note': 'Emails are queued for new vacancies submitted after Resend configuration. Existing vacancies are not automatically backfilled.'}

    def queue_test_notification(self):
        recipient = os.getenv('ADMIN_NOTIFICATION_EMAIL', 'prowellofficial@gmail.com').strip()
        if not email_configured() or not email_valid(recipient):
            return self.send_json(503, {'error': 'Resend is not configured, or the administrator email is invalid.'})
        recent_cutoff = datetime.fromtimestamp(time.time()-120, tz=timezone.utc).isoformat()
        with db_connection() as db:
            recent = db.execute("SELECT COUNT(*) AS n FROM notification_outbox WHERE kind='admin_test' AND createdAt>=?", (recent_cutoff,)).fetchone()['n']
            if recent:
                return self.send_json(429, {'error': 'A test was queued recently. Check delivery history before trying again.'})
            event_id = 'admin-test:' + str(uuid.uuid4())
            db.execute('''INSERT INTO notification_outbox
                (eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
                VALUES (?,?,?,?,?,?,?,'pending',?)''',
                (event_id, 'admin-test', 'admin_test', 'email', recipient,
                 'Prowell Jobs — Email configuration test',
                 'This is a test email from the Prowell Jobs administrator dashboard. No job application data is included.',
                 timestamp()))
        status=deliver_notification_event(event_id)
        notification_wake.set()  # Retry a failure automatically.
        message=('Resend accepted the test email; check Resend Emails and your inbox.'
                 if status=='sent' else
                 'Email not yet accepted. View Notifications for the error and retry status.')
        return self.send_json(202,{'message':message,'status':status or 'sending'})

    # -------- Free member signup and account sessions --------
    def _member_cookie(self, token='', clear=False):
        secure = bool(os.getenv('RAILWAY_ENVIRONMENT') or
                      self.headers.get('X-Forwarded-Proto', '').lower() == 'https')
        text = f'{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax'
        if secure:
            text += '; Secure'
        return text + ('; Max-Age=0' if clear else f'; Max-Age={SESSION_SECONDS}')

    def _member_session(self):
        try:
            cookies=SimpleCookie(); cookies.load(self.headers.get('Cookie', ''))
            cookie=cookies.get(COOKIE_NAME); token=cookie.value if cookie else ''
        except (CookieError, ValueError):
            return None
        if not token or len(token)>160:
            return None
        with db_connection() as db:
            row=db.execute('''SELECT s.tokenHash,s.csrfToken,s.expiresAt,
                m.id,m.email,m.fullName,m.role,m.phone,m.emailVerified
                FROM member_sessions s JOIN members m ON m.id=s.memberId
                WHERE s.tokenHash=?''', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        return dict(row) if row and row['expiresAt'] > time.time() else None

    def _member_write_ok(self, session):
        return bool(session and self.headers.get('X-Member-CSRF') and
                    hmac.compare_digest(session['csrfToken'],self.headers.get('X-Member-CSRF')))

    def _member_public(self, session):
        return {'authenticated':bool(session),
                'member':{k:session[k] for k in ('id','email','fullName','role','phone','emailVerified')} if session else None,
                'csrfToken':session['csrfToken'] if session else None,
                'membership':{'priceKES':0,'free':True,'paymentRequired':False},
                'loginRequiredForSubmissions':True}

    def _member_new_session(self, member_id):
        token=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32)
        with db_connection() as db:
            db.execute('DELETE FROM member_sessions WHERE expiresAt<?',(time.time(),))
            db.execute('INSERT INTO member_sessions VALUES (?,?,?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(),member_id,csrf,timestamp(),time.time()+SESSION_SECONDS))
        session=self._member_session_from_id(member_id,csrf)
        return self.send_json(200,self._member_public(session),{'Set-Cookie':self._member_cookie(token)})

    def _member_session_from_id(self, member_id, csrf):
        with db_connection() as db:
            row=db.execute('SELECT id,email,fullName,role,phone,emailVerified FROM members WHERE id=?',
                           (member_id,)).fetchone()
        return {**dict(row),'csrfToken':csrf} if row else None

    def _create_member(self):
        if not check_rate(self.client_address[0],'member-signup',7):
            return self.send_json(429,{'error':'Too many registration attempts. Try later.'})
        try:
            data=self.json_body()
            email=checked_email(field(data,'email',180,True),True).lower()
            name=field(data,'fullName',120,True)
            role=field(data,'role',30,True)
            phone=field(data,'phone',45)
            password=data.get('password')
            if role not in ('jobseeker','employer','client','writer'):
                raise ValueError('Choose Job seeker, Employer, Writing client or Writer.')
            if not isinstance(password,str) or len(password)<12 or len(password)>128:
                raise ValueError('Use a password of 12–128 characters.')
            if data.get('consent') is not True:
                raise ValueError('Please agree to the privacy notice and terms.')
            if phone and not re.fullmatch(r'\+?[0-9 ()-]{7,24}',phone):
                raise ValueError('Enter a valid contact number including country code.')
            if len(name)<2:
                raise ValueError('Enter your name or business contact name.')
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        mid=str(uuid.uuid4()); salt,digest=password_hash(password)
        verify_token=secrets.token_urlsafe(32)
        verify_hash=hashlib.sha256(verify_token.encode()).hexdigest()
        with db_connection() as db:
            existing=db.execute('SELECT 1 FROM members WHERE email=?',(email,)).fetchone()
            if existing:
                return self.send_json(409,{'error':'An account with this email already exists. Sign in instead.'})
            db.execute('''INSERT INTO members(id,email,fullName,role,phone,passwordSalt,passwordHash,
                verificationHash,verificationExpires,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)''',
                (mid,email,name,role,phone,salt,digest,verify_hash,time.time()+86400,timestamp()))
            if email_configured():
                verify_url='https://prowelljobs.com/api/member/verify?token='+verify_token
                event_id='member:'+mid+':verify'
                db.execute('''INSERT INTO notification_outbox(eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
                  VALUES(?,?,?,?,?,?,?,'pending',?)''',
                  (event_id,mid,'member_verification','email',email,
                   'Verify your Prowell Jobs account',
                   'Welcome to Prowell Jobs. Confirm your email to activate your account:\n'+verify_url+
                   '\nThis link expires in 24 hours. Creating an account and using Prowell Jobs is free.',timestamp()))
        if email_configured():
            deliver_notification_event('member:'+mid+':verify')
            notification_wake.set()
        return self._member_new_session(mid)

    def _login_member(self):
        if not check_rate(self.client_address[0],'member-login',14):
            return self.send_json(429,{'error':'Too many login attempts. Try later.'})
        try:
            data=self.json_body(); email=field(data,'email',180,True).lower()
            password=data.get('password','')
            if not isinstance(password,str):raise ValueError('Invalid credentials.')
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            row=db.execute('SELECT id,passwordSalt,passwordHash FROM members WHERE email=?',(email,)).fetchone()
        if not row or not verify_password(password,row['passwordSalt'],row['passwordHash']):
            return self.send_json(401,{'error':'Incorrect email or password.'})
        return self._member_new_session(row['id'])

    def _logout_member(self):
        session=self._member_session()
        if session and not self._member_write_ok(session):
            return self.send_json(403,{'error':'Invalid session token.'})
        if session:
            with db_connection() as db:
                db.execute('DELETE FROM member_sessions WHERE tokenHash=?',(session['tokenHash'],))
        return self.send_json(200,{'authenticated':False}, {'Set-Cookie':self._member_cookie(clear=True)})

    def _verify_member_email(self):
        from urllib.parse import parse_qs
        qs=parse_qs(urlsplit(self.path).query)
        token=qs.get('token',[''])[0]
        success=False
        if len(token) in range(20,200):
            with db_connection() as db:
                row=db.execute('SELECT id,verificationExpires FROM members WHERE verificationHash=?',
                               (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
                if row and row['verificationExpires'] and row['verificationExpires']>time.time():
                    db.execute('UPDATE members SET emailVerified=1,verificationHash=NULL,verificationExpires=NULL WHERE id=?',(row['id'],))
                    success=True
        # Prevent token leakage into page referrer or browser history after redirect.
        self.send_response(303)
        self.send_header('Location','/account.html?verified='+('1' if success else '0'))
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','no-store')
        self.end_headers()

    def _member_resend_verification(self):
        session=self._member_session()
        if not session:return self.send_json(401,{'error':'Please sign in.'})
        if not self._member_write_ok(session):return self.send_json(403,{'error':'Invalid session validation token.'})
        if session['emailVerified']:
            return self.send_json(200,{'message':'Your email is already verified.'})
        if not check_rate(self.client_address[0], 'member-resend-verification', 5):
            return self.send_json(429,{'error':'Too many verification requests. Please try later.'})
        if not email_configured():
            return self.send_json(503,{'error':'Verification email is temporarily unavailable. Please contact support.'})
        token=secrets.token_urlsafe(32)
        event_id='member:'+session['id']+':verify-resend:'+uuid.uuid4().hex
        url='https://prowelljobs.com/api/member/verify?token='+token
        with db_connection() as db:
            db.execute('UPDATE members SET verificationHash=?,verificationExpires=? WHERE id=? AND emailVerified=0',
                (hashlib.sha256(token.encode()).hexdigest(),time.time()+86400,session['id']))
            db.execute('''INSERT INTO notification_outbox(eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
                VALUES(?,?,?,?,?,?,?,'pending',?)''',
                (event_id,session['id'],'member_verification_resend','email',session['email'],
                 'Verify your Prowell Jobs email address',
                 'Confirm your Prowell Jobs account using this link within 24 hours:\n'+url,timestamp()))
        deliver_notification_event(event_id)
        notification_wake.set()
        return self.send_json(200,{'message':'Verification email requested. Check your inbox and spam folder.'})

    def _member_change_password(self):
        session=self._member_session()
        if not session:return self.send_json(401,{'error':'Please sign in.'})
        if not self._member_write_ok(session):return self.send_json(403,{'error':'Invalid session validation token.'})
        if not check_rate(self.client_address[0],'member-change-password',10):
            return self.send_json(429,{'error':'Too many attempts. Please try again later.'})
        try:
            data=self.json_body()
            old=data.get('currentPassword')
            password=data.get('newPassword')
            if not isinstance(old,str) or not isinstance(password,str) or not 12<=len(password)<=128:
                raise ValueError('Enter your current password and a new password of at least 12 characters.')
            if password!=data.get('confirmPassword'):
                raise ValueError('New passwords do not match.')
        except ValueError as exc:return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            account=db.execute('SELECT passwordSalt,passwordHash FROM members WHERE id=?',(session['id'],)).fetchone()
            if not account or not verify_password(old,account['passwordSalt'],account['passwordHash']):
                return self.send_json(401,{'error':'Current password is incorrect.'})
            if verify_password(password,account['passwordSalt'],account['passwordHash']):
                return self.send_json(400,{'error':'Choose a different new password.'})
            salt,digest=password_hash(password)
            db.execute('UPDATE members SET passwordSalt=?,passwordHash=? WHERE id=?',(salt,digest,session['id']))
            db.execute('DELETE FROM member_sessions WHERE memberId=?',(session['id'],))
        return self.send_json(200,{'message':'Password changed. Please sign in again with your new password.'},
                              {'Set-Cookie':self._member_cookie(clear=True)})

    def _member_profile_update(self):
        session=self._member_session()
        if not session:return self.send_json(401,{'error':'Please sign in.'})
        if not self._member_write_ok(session):return self.send_json(403,{'error':'Invalid session validation token.'})
        if not check_rate(self.client_address[0],'member-profile-update',30):
            return self.send_json(429,{'error':'Too many updates. Please try later.'})
        try:
            data=self.json_body()
            name=field(data,'fullName',120,True)
            phone=field(data,'phone',45)
            if len(name)<2:raise ValueError('Enter a name of at least two characters.')
            if phone and not re.fullmatch(r'\+?[0-9 ()-]{7,24}',phone):
                raise ValueError('Enter a valid phone number.')
        except ValueError as exc:return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            db.execute('UPDATE members SET fullName=?,phone=? WHERE id=?',(name,phone,session['id']))
        return self.send_json(200,{'message':'Profile updated.', 'fullName':name,'phone':phone})

    def _employer_applications(self):
        session=self._member_session()
        if not session:return self.send_json(401,{'error':'Please sign in.'})
        if session['role']!='employer' or not session['emailVerified']:
            return self.send_json(403,{'error':'Only a verified employer can view reviewed applications for their jobs.'})
        with db_connection() as db:
            rows=db.execute('''SELECT a.id,a.jobId,a.jobTitle,a.fullName,a.email,a.phone,
                a.country,a.city,a.experience,a.message,a.status,a.createdAt
                FROM applications a JOIN jobs j ON a.jobId=j.id
                WHERE j.memberId=? AND a.status IN ('reviewed','closed')
                ORDER BY a.createdAt DESC LIMIT 150''',(session['id'],)).fetchall()
        return self.send_json(200,{'applications':[dict(r) for r in rows]})

    def _member_dashboard(self):
        session=self._member_session()
        if not session:
            return self.send_json(401,{'error':'Please sign in.'})
        member_id=session['id']
        with db_connection() as db:
            result={}
            for table,cols in {
                'jobs':'id,title,company,location,status,createdAt',
                'applications':'id,jobTitle,employerName,status,createdAt',
                'candidates':'id,alias,category,status,createdAt',
            }.items():
                rows=db.execute(f'SELECT {cols} FROM {table} WHERE memberId=? ORDER BY createdAt DESC LIMIT 100',
                                (member_id,)).fetchall()
                result[table]=[dict(row) for row in rows]
        return self.send_json(200, result)

    def _member_forgot(self):
        if not check_rate(self.client_address[0],'member-recovery',6):
            return self.send_json(429,{'error':'Too many requests. Try again later.'})
        try:
            data=self.json_body(); email=checked_email(field(data,'email',180,True),True).lower()
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            row=db.execute('SELECT id FROM members WHERE email=?',(email,)).fetchone()
            if row and email_configured():
                token=secrets.token_urlsafe(32)
                db.execute('UPDATE members SET recoveryHash=?,recoveryExpires=? WHERE id=?',
                           (hashlib.sha256(token.encode()).hexdigest(),time.time()+3600,row['id']))
                event_id='member:'+row['id']+':recovery:'+secrets.token_hex(5)
                url='https://prowelljobs.com/account.html?reset='+token
                db.execute('''INSERT INTO notification_outbox(eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
                    VALUES(?,?,?,?,?,?,?,'pending',?)''',
                    (event_id,row['id'],'member_recovery','email',email,'Reset your Prowell Jobs password',
                     'Use this link to reset your password (expires in 1 hour):\n'+url+'\nIf this was not you, ignore this message.',timestamp()))
            else:
                event_id=None
        if event_id:
            deliver_notification_event(event_id);notification_wake.set()
        return self.send_json(200,{'message':'If that email has an account, a password reset link will be sent.'})

    def _member_reset(self):
        if not check_rate(self.client_address[0],'member-reset',10):
            return self.send_json(429,{'error':'Too many password reset attempts.'})
        try:
            data=self.json_body()
            token=field(data,'token',150,True)
            password=data.get('password')
            if data.get('confirmPassword',password)!=password:
                raise ValueError('Passwords do not match.')
            if len(token)<25 or not isinstance(password,str) or not 12<=len(password)<=128:
                raise ValueError('Invalid or expired reset link, or password too short.')
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        salt,digest=password_hash(password)
        with db_connection() as db:
            row=db.execute('SELECT id,recoveryExpires FROM members WHERE recoveryHash=?',
                           (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            if not row or row['recoveryExpires']<=time.time():
                return self.send_json(400,{'error':'Reset link invalid or expired.'})
            db.execute('''UPDATE members SET passwordSalt=?,passwordHash=?,recoveryHash=NULL,
                recoveryExpires=NULL WHERE id=?''',(salt,digest,row['id']))
            db.execute('DELETE FROM member_sessions WHERE memberId=?',(row['id'],))
        return self.send_json(200,{'message':'Password updated. Sign in with your new password.'})

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
        if path.startswith('/api/writing/') or path.startswith('/api/admin/writing/'):
            return Marketplace(self, db_connection, deliver_notification_event, notification_wake, check_rate, WRITING_UPLOAD_ROOT).handle('GET')
        if path == '/api/member/me':
            return self.send_json(200,self._member_public(self._member_session()))
        if path == '/api/member/verify':
            return self._verify_member_email()
        if path == '/api/member/dashboard':
            return self._member_dashboard()
        if path == '/api/member/employer/applications':
            return self._employer_applications()
        if path == '/api/admin/bootstrap/status':
            return self.send_json(200, {'registrationOpen': not self.admin_owner_exists()})
        if path == '/api/admin/extension/events':
            return owner_extension.list_report_events(self, db_connection)
        if path == '/api/admin/good-writers/events':
            return good_writers_reports.events(self, db_connection)
        if path == '/api/admin/good-writers/extension/status':
            return owner_extension.good_writers_status(self, ROOT)
        if path == '/api/admin/good-writers/extension/download':
            return owner_extension.good_writers_download(self, ROOT)
        if path == '/api/admin/extension/status':
            return owner_extension.status(self, DATABASE_PATH, ROOT)
        if path == '/api/admin/extension/download':
            return owner_extension.download(self, DATABASE_PATH, ROOT)
        if path == '/api/admin/session':
            session = self.admin_session()
            return self.send_json(200, {'authenticated': bool(session),
                'ownerConfigured': self.admin_owner_exists(),
                'csrfToken': session['csrfToken'] if session else None,
                'expiresAt': session['expiresAt'] if session else None})
        if path == '/api/health':
            return self.send_json(200,{'status':'ok','app':'Prowell Jobs'})
        public = {'/api/jobs':('jobs',None), '/api/reviews':('reviews',PUBLIC_REVIEW_FIELDS),
                  '/api/candidates':('candidates',PUBLIC_CANDIDATE_FIELDS)}
        if path in public:
            table, allowed = public[path]
            cols = ','.join(JOB_COLUMNS) if table == 'jobs' else (','.join(allowed) if allowed is not None else '*')
            with db_connection() as db:
                rows = db.execute(f'SELECT {cols} FROM {table} WHERE status=? ORDER BY createdAt DESC LIMIT 500',('approved',)).fetchall()
            output = [dict(row) for row in rows]
            if table == 'jobs':
                output = [r for r in output if not r.get('deadline') or r['deadline'] >= datetime.now(timezone.utc).strftime('%Y-%m-%d')]
            return self.send_json(200,{table:output})
        if path == '/api/admin/documents/history':
            return admin_docs.handle_get(self, db_connection)
        if path == '/api/admin/activity':
            # Seven-day view, not deletion. Keep historic business records intact.
            if not self.admin_session():
                return self.send_json(401, {'error':'Administrator sign-in required.'})
            admin_docs.initialize_table(db_connection)
            cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            history = []
            def add(kind, title, when, recipient='', detail='', status=''):
                history.append({'type':kind, 'title':title, 'createdAt':when,
                                'recipient':recipient or '', 'detail':detail or '', 'status':status or ''})
            with db_connection() as db:
                for r in db.execute('''SELECT title,company,COALESCE(notifyEmail,email,'') AS contact,status,createdAt
                    FROM jobs WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 100''',(cutoff,)):
                    add('job',r['title'],r['createdAt'],r['contact'],r['company'],r['status'])
                for r in db.execute('''SELECT jobTitle,fullName,email,status,createdAt
                    FROM applications WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 100''',(cutoff,)):
                    add('application',r['jobTitle'],r['createdAt'],r['email'],r['fullName'],r['status'])
                for r in db.execute('''SELECT o.title,o.status,o.createdAt,m.email AS clientEmail
                    FROM writing_orders o JOIN members m ON m.id=o.clientId
                    WHERE o.createdAt >= ? ORDER BY o.createdAt DESC LIMIT 100''',(cutoff,)):
                    add('writing_order',r['title'],r['createdAt'],r['clientEmail'],'Client request',r['status'])
                for r in db.execute('''SELECT o.title,a.createdAt,m.fullName,m.email
                    FROM writing_assignment_audit a
                    JOIN writing_bids b ON b.id=a.bidId
                    JOIN members m ON m.id=b.writerId
                    JOIN writing_orders o ON o.id=a.orderId
                    WHERE a.createdAt >= ? ORDER BY a.createdAt DESC LIMIT 100''',(cutoff,)):
                    add('writer_assignment',r['title'],r['createdAt'],r['email'],r['fullName'],'Assigned')
                for r in db.execute('''SELECT filename,recipient,subject,sentAt,providerEmailId
                    FROM admin_document_sends WHERE sentAt >= ? ORDER BY sentAt DESC LIMIT 100''',(cutoff,)):
                    add('document_sent',r['filename'],r['sentAt'],r['recipient'],r['subject'],
                        'Accepted by Resend' if r['providerEmailId'] else 'Unknown')
            history.sort(key=lambda r: r['createdAt'], reverse=True)
            return self.send_json(200, {'days':7,'records':history[:150]})
        if path.startswith('/api/admin/'):
            if not self.authorized():
                return self.send_json(401,{'error':'Invalid administrator key.'})
            if path == '/api/admin/unread_counts':
                return self.send_json(200, self.admin_unread_counts())
            if path == '/api/admin/notification_status':
                return self.send_json(200, self.notification_diagnostics())
            table = path.split('/')[-1]
            if table not in ('jobs','candidates','reviews','reports','alerts','applications','notification_outbox'):
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
        allowed = {'/','/index.html','/jobs.html','/account.html','/dashboard.html','/writing.html','/writing-admin.html','/writing.css','/writing.js','/writing-admin.js','/membership.css','/member.js','/admin-account.js','/styles.css','/app.js','/admin.html','/admin.js','/admin-documents.html','/admin-documents.js','/favicon.svg','/robots.txt','/sitemap.xml'}
        if path not in allowed and not (path.startswith('/assets/') and path.endswith(('.svg','.png','.jpg','.webp')) and '..' not in path):
            return self.send_json(404,{'error':'File not found.'})
        # This static page is allowed; its send/history APIs require an admin session.
        # Cookie Path=/api/admin is not sent to /admin-documents.html.
        if path in ('/jobs.html','/writing.html','/dashboard.html') and not self._member_session():
            from urllib.parse import quote
            self.send_response(302)
            self.send_header('Location','/account.html?mode=login&next='+quote(path,safe=''))
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            return
        if path == '/':
            self.path = '/index.html'
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/writing/') or path.startswith('/api/admin/writing/'):
            return Marketplace(self, db_connection, deliver_notification_event, notification_wake, check_rate, WRITING_UPLOAD_ROOT).handle('POST')
        if path == '/api/member/signup':
            return self._create_member()
        if path == '/api/member/login':
            return self._login_member()
        if path == '/api/member/logout':
            return self._logout_member()
        if path == '/api/member/forgot':
            return self._member_forgot()
        if path == '/api/member/reset':
            return self._member_reset()
        if path == '/api/member/verification/resend':
            return self._member_resend_verification()
        if path == '/api/member/password/change':
            return self._member_change_password()
        if path == '/api/member/profile/update':
            return self._member_profile_update()
        if path == '/api/admin/recovery/start':
            return self.admin_recovery_start()
        if path == '/api/admin/recovery/complete':
            return self.admin_recovery_complete()
        if path == '/api/admin/bootstrap':
            return self.admin_bootstrap()
        if path == '/api/admin/login':
            return self.admin_login()
        if path == '/api/admin/logout':
            return self.admin_logout()
        if path == '/api/admin/tab-viewed':
            return self.mark_admin_tab_viewed()
        if path == '/api/admin/paraphrase':
            return admin_paraphraser.handle_rewrite(self, check_rate)
        if path == '/api/admin/documents/send':
            return admin_docs.handle_post(self, db_connection, check_rate)
        if path == '/api/admin/good-writers/pair':
            return good_writers_reports.pair(self, db_connection)
        if path == '/api/admin/good-writers/revoke':
            return good_writers_reports.revoke(self, db_connection)
        if path == '/api/good-writers/report/verify':
            return good_writers_reports.verify(self, db_connection)
        if path == '/api/good-writers/report':
            return good_writers_reports.receive(self, db_connection)
        if path == '/api/admin/extension/pair':
            return owner_extension.create_report_token(self, db_connection)
        if path == '/api/admin/extension/revoke':
            return owner_extension.revoke_report_token(self, db_connection)
        if path == '/api/extension/claim-report':
            return owner_extension.receive_report(self, db_connection)
        if path == '/api/admin/extension/upload':
            return owner_extension.upload(self, DATABASE_PATH, ROOT)
        if path == '/api/admin/notifications/test':
            if not self.authorized():
                return self.send_json(401, {'error': 'Sign in as administrator.'})
            if not self.admin_write_authorized():
                return self.send_json(403, {'error': 'Invalid session validation token.'})
            return self.queue_test_notification()
        validators = {'/api/jobs':('jobs',validate_job),'/api/candidates':('candidates',validate_candidate),
                      '/api/reviews':('reviews',validate_review),'/api/reports':('reports',validate_report),
                      '/api/alerts':('alerts',validate_alert),'/api/applications':('applications',validate_application)}
        if path not in validators:
            return self.send_json(404,{'error':'Unknown endpoint.'})
        table,validate = validators[path]
        member_for_submission = None
        if MEMBER_LOGIN_REQUIRED and table in ('jobs','candidates','applications'):
            session=self._member_session()
            role='employer' if table=='jobs' else 'jobseeker'
            if not self._member_write_ok(session) or session['role']!=role:
                return self.send_json(401,{'error':f'Sign in as a {role} before submitting.'})
            member_for_submission = session['id']
            if MEMBER_EMAIL_VERIFICATION_REQUIRED and not session['emailVerified']:
                return self.send_json(403,{'error':'Verify your email address before submitting.'})
        try:
            raw = self.json_body()
            result = validate(raw)
            obj, withdrawal = result if table in ('candidates','applications') else (result,None)
            if member_for_submission:
                obj['memberId'] = member_for_submission
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        if not check_rate(self.client_address[0],table,4 if table != 'jobs' else 6):
            return self.send_json(429,{'error':'Too many submissions; try again later.'})
        cols = list(obj)
        with db_connection() as db:
            db.execute(f'INSERT INTO {table} ({",".join(cols)}) VALUES ({",".join("?" for _ in cols)})',list(obj.values()))
            queued = queue_job_notices(db,obj,'submitted') if table == 'jobs' else 0
            other_events = queue_request_notices(db, table, obj) if table != 'jobs' else []
        if queued and table == 'jobs':
            # Attempt both the admin alert and the employer acknowledgment now.
            # Employer email is sent only when explicit consent + address exist.
            # Failed sends remain queued for background retries.
            deliver_job_emails_now(obj['id'], 'submitted')
        if queued or other_events: notification_wake.set()
        response = {'message':'Submitted for review. It will not appear publicly until approved.','id':obj['id']}
        if table != 'jobs':
            response['confirmationEmailQueued'] = any(x.endswith(':submitter:email') for x in other_events)
        if table == 'jobs':
            response['employerEmailQueued'] = bool(obj['notifyConsent'] and obj['notifyEmail'])
        if withdrawal:
            response['withdrawalCode'] = withdrawal
            response['message'] = ('Application received by Prowell Jobs for manual review; not sent to the employer automatically. Save your withdrawal code.'
                                   if table == 'applications' else 'Candidate profile received for review. Save your private withdrawal code.')
        if table == 'alerts':
            response['message'] = 'Saved your interest in future job alerts. We will email a registration receipt. Actual job-alert emails are not enabled; use RSS for live listings.'
        return self.send_json(201,response)

    def do_PATCH(self):
        path = urlsplit(self.path).path
        parts = path.split('/')
        if len(parts) != 5 or parts[:3] != ['','api','admin'] or parts[3] not in ('jobs','candidates','reviews','reports','applications'):
            return self.send_json(404,{'error':'Unknown endpoint.'})
        if not self.authorized():
            return self.send_json(401, {'error': 'Sign in as administrator.'})
        if not self.admin_write_authorized():
            return self.send_json(403, {'error': 'Invalid session validation token.'})
        try:
            uuid.UUID(parts[4])
            data = self.json_body()
            allowed = ('pending','reviewed','closed') if parts[3] == 'applications' else STATUS_VALUES
            if not isinstance(data,dict) or data.get('status') not in allowed:
                raise ValueError('Choose a valid record status.')
            if 'verified' in data and (parts[3] != 'jobs' or type(data['verified']) is not bool):
                raise ValueError('Verified may be set only for jobs.')
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        with db_connection() as db:
            old_job = db.execute('SELECT * FROM jobs WHERE id=?',(parts[4],)).fetchone() if parts[3] == 'jobs' else None
            old_request = db.execute(f'SELECT * FROM {parts[3]} WHERE id=?',(parts[4],)).fetchone() if parts[3] != 'jobs' else None
            if parts[3] == 'jobs' and 'verified' in data:
                done = db.execute('UPDATE jobs SET status=?,verified=? WHERE id=?',
                                  (data['status'],int(data['verified']),parts[4]))
            else:
                done = db.execute(f'UPDATE {parts[3]} SET status=? WHERE id=?',(data['status'],parts[4]))
            queued = 0
            other_events = []
            if done.rowcount and old_job and old_job['status'] != data['status'] and data['status'] in ('approved','rejected'):
                queued = queue_job_notices(db,old_job,data['status'])
            if done.rowcount and parts[3] != 'jobs':
                # Status updates are notices, never hiring decisions.
                if old_request and old_request['status'] != data['status'] and data['status'] in ('approved','rejected','reviewed','closed'):
                    other_events = queue_request_notices(db,parts[3],old_request,data['status'])
        if queued and old_job and data['status'] in ('approved','rejected'):
            # Notify the consenting employer about the decision right away.
            deliver_job_emails_now(old_job['id'], data['status'])
        if queued or other_events: notification_wake.set()
        return self.send_json(200,{'message':'Updated.'}) if done.rowcount else self.send_json(404,{'error':'Record not found.'})

    def do_DELETE(self):
        path = urlsplit(self.path).path
        parts = path.split('/')
        if len(parts) != 4 or parts[:2] != ['','api'] or parts[2] not in ('candidates','applications'):
            return self.send_json(404,{'error':'Unknown endpoint.'})
        try:
            uuid.UUID(parts[3])
            payload = self.json_body()
            code = field(payload,'withdrawalCode',150,True)
        except ValueError as exc:
            return self.send_json(400,{'error':str(exc)})
        table = parts[2]
        with db_connection() as db:
            row = db.execute(f'SELECT withdrawalHash FROM {table} WHERE id=?',(parts[3],)).fetchone()
            if not row or not hmac.compare_digest(row['withdrawalHash'],hashlib.sha256(code.encode()).hexdigest()):
                return self.send_json(403,{'error':'Invalid record ID or withdrawal code.'})
            db.execute(f'DELETE FROM {table} WHERE id=?',(parts[3],))
        return self.send_json(200,{'message':'Your record has been withdrawn and deleted.'})

    def do_HEAD(self):
        if urlsplit(self.path).path in {'/','/index.html','/favicon.svg','/robots.txt','/sitemap.xml'}:
            super().do_HEAD()
        else:
            self.send_response(405)
            self.end_headers()


if __name__ == '__main__':
    initialize_db()
    threading.Thread(target=notification_loop,daemon=True,name='prowell-notifier').start()
    notification_wake.set()
    server = ThreadingHTTPServer(('0.0.0.0',PORT),Handler)
    print(f'[Prowell Jobs] Running at http://localhost:{PORT}',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
