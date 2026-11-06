"""Good-Writers-only reporting tokens and claim notifications.

Separate from 4writers reports, credentials and admin session. Extension tokens
can submit metadata, never access owner account data.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timezone


def _tables(db):
    db.execute("""CREATE TABLE IF NOT EXISTS good_writers_report_token(
        id INTEGER PRIMARY KEY CHECK(id=1),
        token_hash TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS good_writers_claim_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        order_id TEXT NOT NULL, outcome TEXT NOT NULL,
        stage TEXT NOT NULL, elapsed_ms INTEGER,
        detail TEXT NOT NULL, created_at TEXT NOT NULL
    )""")


def _owner(handler, write=False):
    if not handler.admin_session():
        handler.send_json(401, {'error': 'Administrator sign-in required.'})
        return False
    if write and not handler.admin_write_authorized():
        handler.send_json(403, {'error': 'Administrator CSRF check failed.'})
        return False
    return True


def pair(handler, db_connection):
    if not _owner(handler, write=True):
        return
    code = secrets.token_urlsafe(36)
    with db_connection() as db:
        _tables(db)
        db.execute('DELETE FROM good_writers_report_token')
        db.execute(
            'INSERT INTO good_writers_report_token(id,token_hash,created_at) VALUES(1,?,?)',
            (hashlib.sha256(code.encode()).hexdigest(), datetime.now(timezone.utc).isoformat())
        )
    return handler.send_json(200, {'pairingCode': code,
        'message': 'New Good-Writers reporting code. Previous Good-Writers code revoked; 4writers remains unchanged.'})


def revoke(handler, db_connection):
    if not _owner(handler, write=True):
        return
    with db_connection() as db:
        _tables(db)
        db.execute('DELETE FROM good_writers_report_token')
    return handler.send_json(200, {'paired': False})


def events(handler, db_connection):
    if not _owner(handler):
        return
    with db_connection() as db:
        _tables(db)
        paired = db.execute('SELECT 1 FROM good_writers_report_token WHERE id=1').fetchone() is not None
        rows = db.execute("""SELECT order_id,outcome,stage,elapsed_ms,detail,created_at
            FROM good_writers_claim_events ORDER BY id DESC LIMIT 100""").fetchall()
    return handler.send_json(200, {'paired':paired, 'events': [
        {'orderId':r['order_id'],'outcome':r['outcome'],'stage':r['stage'],
         'elapsedMs':r['elapsed_ms'],'detail':r['detail'],'createdAt':r['created_at']}
        for r in rows]})


def authorized_reporter(handler, db_connection):
    value = handler.headers.get('Authorization', '')
    if not value.startswith('Bearer '):
        handler.send_json(401, {'error':'Good-Writers pairing required.'})
        return False
    code = value[7:]
    if len(code) < 30 or len(code) > 180:
        handler.send_json(401, {'error':'Invalid pairing code.'})
        return False
    digest = hashlib.sha256(code.encode()).hexdigest()
    with db_connection() as db:
        _tables(db)
        row = db.execute('SELECT token_hash FROM good_writers_report_token WHERE id=1').fetchone()
    if not row or not secrets.compare_digest(row['token_hash'],digest):
        handler.send_json(401, {'error':'Good-Writers pairing code revoked or incorrect.'})
        return False
    return True


def verify(handler, db_connection):
    if not authorized_reporter(handler, db_connection):
        return
    return handler.send_json(200, {'paired':True, 'message':'Good-Writers reports connected.'})


def receive(handler, db_connection):
    if not authorized_reporter(handler, db_connection):
        return
    try:
        body = handler.json_body()
        if not isinstance(body, dict):
            raise ValueError('Invalid report.')
        event_key = body.get('eventKey')
        order_id = str(body.get('orderId',''))
        outcome = body.get('outcome')
        stage = body.get('stage')
        elapsed = body.get('elapsedMs')
        detail = body.get('detail','')
        if not isinstance(event_key,str) or not re.fullmatch(r'[A-Za-z0-9_-]{12,80}',event_key):
            raise ValueError('Invalid event key.')
        if not re.fullmatch(r'[0-9]{5,16}',order_id):
            raise ValueError('Invalid order ID.')
        if outcome not in ('success','failure','uncertain'):
            raise ValueError('Invalid outcome.')
        if stage not in ('view','take','ok','acknowledge','result','timeout','security'):
            raise ValueError('Invalid stage.')
        if not isinstance(elapsed,int) or not 0 <= elapsed <= 120000:
            raise ValueError('Invalid duration.')
        if not isinstance(detail,str) or len(detail) > 400:
            raise ValueError('Invalid description.')
    except ValueError as exc:
        return handler.send_json(400, {'error':str(exc)})
    with db_connection() as db:
        _tables(db)
        db.execute("""INSERT OR IGNORE INTO good_writers_claim_events
            (event_key,order_id,outcome,stage,elapsed_ms,detail,created_at)
            VALUES(?,?,?,?,?,?,?)""",
            (event_key,order_id,outcome,stage,elapsed,detail,
             datetime.now(timezone.utc).isoformat()))
    return handler.send_json(202, {'received':True})
