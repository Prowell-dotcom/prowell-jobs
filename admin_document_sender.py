"""Owner-only direct document emails via Resend.

Files are handled in memory, never written to a public directory. Document
metadata (but not contents) is recorded in the persistent SQLite database.
No third-party Python packages are required.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MAX_DOCUMENT_BYTES = 7 * 1024 * 1024  # Each attachment.
MAX_ATTACHMENTS = 5
MAX_TOTAL_DOCUMENT_BYTES = 15 * 1024 * 1024  # Combined attachment bytes.
MAX_REQUEST_BYTES = 22 * 1024 * 1024  # Base64 JSON overhead; remains bounded.
ACCEPTED_EXTENSIONS = frozenset({
    '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.ods', '.odp',
    '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.jpg', '.jpeg', '.png',
})
EMAIL_RE = re.compile(r'^[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,63}$')


class DocumentSendError(Exception):
    pass


def initialize_table(db_connection):
    with db_connection() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS admin_document_sends (
          id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL,
          filename TEXT NOT NULL, fileBytes INTEGER NOT NULL, providerEmailId TEXT,
          sentAt TEXT NOT NULL
        )''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_admin_docs_sent ON admin_document_sends(sentAt DESC)')


def _clean_text(value, label, maxlen, required=True):
    if not isinstance(value, str):
        raise ValueError(f'{label} must be text.')
    value = value.strip()
    if (required and not value) or len(value) > maxlen or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise ValueError(f'Enter a valid {label.lower()} (up to {maxlen} characters).')
    return value


def validate_document(payload):
    if not isinstance(payload, dict):
        raise ValueError('Invalid document submission.')
    recipient = _clean_text(payload.get('recipient'), 'Recipient email', 254)
    if not EMAIL_RE.fullmatch(recipient) or '..' in recipient or any(c in recipient for c in '\r\n'):
        raise ValueError('Enter a valid recipient email address.')
    subject = _clean_text(payload.get('subject'), 'Subject', 160)
    if '\n' in subject or '\r' in subject:
        raise ValueError('Subject must be on one line.')
    message = _clean_text(payload.get('message', ''), 'Message', 3000, required=False)
    if not message:
        message = 'Please find the attached document.'
    uploads = payload.get('attachments')
    # Continue accepting the old single-file payload from previously cached pages.
    if uploads is None:
        uploads = [{'filename': payload.get('filename'), 'contentBase64': payload.get('fileBase64')}]
    if not isinstance(uploads, list) or not 1 <= len(uploads) <= MAX_ATTACHMENTS:
        raise ValueError('Choose between one and five attachments.')
    attachments = []
    total_size = 0
    for upload in uploads:
        if not isinstance(upload, dict):
            raise ValueError('Invalid attachment details.')
        filename = _clean_text(upload.get('filename'), 'Filename', 120)
        if any(c in filename for c in '/\\\r\n\0') or filename in ('.', '..'):
            raise ValueError('Invalid attachment filename.')
        ext = '.' + filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        if ext not in ACCEPTED_EXTENSIONS:
            raise ValueError('Unsupported file type. Use PDF, Office documents, text, image, or OpenDocument files.')
        encoded = upload.get('contentBase64')
        if not isinstance(encoded, str) or len(encoded) > ((MAX_DOCUMENT_BYTES + 2) // 3) * 4 + 16:
            raise ValueError('Each attachment must be 7 MB or smaller.')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('An uploaded file could not be read.') from None
        if not raw or len(raw) > MAX_DOCUMENT_BYTES:
            raise ValueError('Each attachment must be nonempty and at most 7 MB.')
        total_size += len(raw)
        if total_size > MAX_TOTAL_DOCUMENT_BYTES:
            raise ValueError('Combined attachments must be 15 MB or smaller.')
        if ext == '.pdf' and not raw.startswith(b'%PDF-'):
            raise ValueError('A selected file is not a valid PDF.')
        if ext == '.png' and not raw.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('A selected file is not a PNG image.')
        if ext in ('.jpg', '.jpeg') and not raw.startswith(b'\xff\xd8\xff'):
            raise ValueError('A selected file is not a JPEG image.')
        if ext in ('.docx','.xlsx','.pptx','.odt','.ods','.odp') and not raw.startswith(b'PK'):
            raise ValueError('A selected file does not match its document extension.')
        attachments.append({'filename': filename, 'content': encoded, 'fileBytes': len(raw)})
    filenames = ', '.join(item['filename'] for item in attachments)
    request_id = payload.get('requestId')
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', request_id):
        raise ValueError('Refresh the page and try sending again.')
    if payload.get('confirmed') is not True:
        raise ValueError('Confirm that the recipient and attachment are correct before sending.')
    return {'recipient':recipient, 'subject':subject, 'message':message,
            'filename':filenames, 'attachments':attachments, 'fileBytes':total_size, 'requestId':request_id}


def send_via_resend(data):
    """Returns provider email ID on successful API acceptance (not inbox delivery)."""
    sender = os.getenv('NOTIFY_FROM_EMAIL', '')
    key = os.getenv('RESEND_API_KEY', '')
    if not sender or not key:
        raise DocumentSendError('Email provider not configured; check Railway Resend variables.')
    body = {
        'from':f'Prowell Jobs <{sender}>',
        'to':[data['recipient']],
        'subject':data['subject'],
        'text':data['message'] + '\n\n— Prowell Jobs\nhttps://prowelljobs.com',
        'reply_to':['prowellofficial@gmail.com'],
        'attachments':[{'filename':f['filename'],'content':f['content']} for f in data['attachments']],
    }
    request = Request('https://api.resend.com/emails',
        data=json.dumps(body,ensure_ascii=False).encode('utf-8'),method='POST',headers={
            'Authorization':'Bearer '+key, 'Content-Type':'application/json',
            'Accept':'application/json', 'User-Agent':'ProwellJobs/1.0',
            'Idempotency-Key':'admin-document-'+data['requestId'],
        })
    try:
        with urlopen(request,timeout=20) as response:
            content=response.read(4096)
            if not 200 <= response.status < 300:
                raise DocumentSendError(f'Email provider returned HTTP {response.status}.')
            answer=json.loads(content.decode('utf-8'))
            email_id=answer.get('id')
            if not isinstance(email_id,str) or not email_id:
                raise DocumentSendError('Email provider returned no message reference.')
            return email_id
    except HTTPError as exc:
        label = ''
        try:
            body = json.loads(exc.read(2048))
            label = re.sub('[^A-Za-z0-9_-]','',str(body.get('name','')))[:45]
        except (ValueError,TypeError,UnicodeError):
            pass
        raise DocumentSendError(f'Resend rejected the email (HTTP {exc.code}' + (f' {label}' if label else '') + ').') from None
    except (URLError,TimeoutError,OSError):
        raise DocumentSendError('Could not reach Resend. Check email delivery logs before retrying.') from None


def handle_get(handler, db_connection):
    if not handler.admin_session():
        return handler.send_json(401,{'error':'Administrator sign-in required.'})
    initialize_table(db_connection)
    with db_connection() as db:
        records = [dict(row) for row in db.execute('''SELECT id,recipient,subject,filename,fileBytes,
            providerEmailId,sentAt FROM admin_document_sends ORDER BY sentAt DESC LIMIT 30''').fetchall()]
    handler.send_json(200,{'records':records, 'maxFileBytes':MAX_DOCUMENT_BYTES,
                           'maxTotalBytes':MAX_TOTAL_DOCUMENT_BYTES, 'maxAttachments':MAX_ATTACHMENTS})


def handle_post(handler,db_connection,check_rate):
    if not handler.admin_session():
        return handler.send_json(401,{'error':'Administrator sign-in required.'})
    if not handler.admin_write_authorized():
        return handler.send_json(403,{'error':'Administrator session verification failed.'})
    try:
        length = int(handler.headers.get('Content-Length', '0'))
        if length < 1 or length > MAX_REQUEST_BYTES:
            return handler.send_json(413,{'error':'Upload too large. Maximum combined attachments: 15 MB.'})
        payload = json.loads(handler.rfile.read(length).decode('utf-8'))
        data = validate_document(payload)
    except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError) as exc:
        return handler.send_json(400,{'error':str(exc) if isinstance(exc,ValueError) else 'Invalid upload.'})
    initialize_table(db_connection)
    # Deduplicate retries with a persisted request ID and Resend idempotency key.
    with db_connection() as db:
        existing = db.execute('SELECT recipient,filename,providerEmailId FROM admin_document_sends WHERE id=?',
                              (data['requestId'],)).fetchone()
    if existing:
        if existing['recipient'] == data['recipient'] and existing['filename'] == data['filename']:
            return handler.send_json(200,{'message':'Previously accepted by Resend.', 'emailId':existing['providerEmailId']})
        return handler.send_json(409,{'error':'This send reference was already used. Refresh the page.'})
    if not check_rate(handler.client_address[0],'admin-document-send',12):
        return handler.send_json(429,{'error':'Send limit reached (12 per hour). Try again later.'})
    try:
        email_id = send_via_resend(data)
    except DocumentSendError as exc:
        return handler.send_json(502,{'error':str(exc)})
    with db_connection() as db:
        db.execute('''INSERT OR IGNORE INTO admin_document_sends
            (id,recipient,subject,filename,fileBytes,providerEmailId,sentAt) VALUES (?,?,?,?,?,?,?)''',
           (data['requestId'],data['recipient'],data['subject'],data['filename'],data['fileBytes'],
            email_id,datetime.now(timezone.utc).isoformat()))
    handler.send_json(200,{'message':'Email with attachments accepted by Resend. Inbox delivery is not yet confirmed.',
                           'emailId':email_id})
