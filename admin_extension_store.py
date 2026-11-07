"""Private administrator-only browser extension ZIP storage.

Bundles are uploaded by the owner and kept outside the website's public directory.
There is deliberately no public static URL for the ZIP.
"""
from __future__ import annotations

import hashlib
import json
import re
import os
import secrets
import stat
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path, PurePosixPath

MAX_ZIP_BYTES = 2 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024
MAX_ENTRIES = 40
BUNDLE_NAME = 'prowell-4writers-assistant.zip'


def private_path(database_path: Path, root: Path) -> Path:
    root = root.resolve()
    parent = database_path.resolve().parent
    base = parent if parent != root else root.parent
    folder = (base / 'prowell-private-extensions').resolve()
    if folder == root or root in folder.parents:
        raise RuntimeError('Private browser extension directory must be outside the web root.')
    return folder / BUNDLE_NAME


def validate_bundle(data: bytes) -> str:
    """Check ZIP layout, bounds and a Manifest V3 before accepting an upload."""
    if not data or len(data) > MAX_ZIP_BYTES:
        raise ValueError('ZIP must be between 1 byte and 2 MB.')
    try:
        with zipfile.ZipFile(BytesIO(data), 'r') as bundle:
            entries = bundle.infolist()
            regular = [entry for entry in entries if not entry.is_dir()]
            if not regular or len(entries) > MAX_ENTRIES:
                raise ValueError('The ZIP is empty or contains too many files.')
            if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError('The ZIP contents are too large.')
            seen = set()
            for entry in entries:
                name = entry.filename
                path = PurePosixPath(name)
                if (not name or name.startswith('/') or '\\' in name or
                    ':' in name or any(p in ('', '.', '..') for p in name.rstrip('/').split('/')) or
                    len(path.parts) > 4):
                    raise ValueError('The ZIP has an unsafe file path.')
                if (entry.external_attr >> 16) & 0o170000 == stat.S_IFLNK:
                    raise ValueError('ZIP symlinks are not supported.')
                key = name.rstrip('/').lower()
                if key in seen:
                    raise ValueError('The ZIP has duplicate file names.')
                seen.add(key)
            manifests = [item for item in regular if item.filename == 'manifest.json'
                         or item.filename.endswith('/manifest.json')]
            if len(manifests) != 1:
                raise ValueError('ZIP must contain exactly one manifest.json.')
            prefix = manifests[0].filename[:-len('manifest.json')]
            if any(not item.filename.startswith(prefix) for item in regular):
                raise ValueError('All extension files must be inside one folder.')
            allowed_suffixes = {'.json', '.js', '.html', '.css', '.md', '.svg', '.png', '.webp', '.ico', '.txt'}
            if any(PurePosixPath(item.filename).suffix.lower() not in allowed_suffixes for item in regular):
                raise ValueError('The ZIP contains an unsupported file type.')
            manifest = json.loads(bundle.read(manifests[0]).decode('utf-8'))
            if not isinstance(manifest, dict) or manifest.get('manifest_version') != 3:
                raise ValueError('A Chrome Manifest V3 extension is required.')
            if not str(manifest.get('name', '')).lower().startswith('prowell'):
                raise ValueError('Upload the Prowell browser extension, not an unrelated ZIP.')
            version = str(manifest.get('version', ''))
            if not version or len(version) > 35:
                raise ValueError('The extension manifest is missing a version.')
            return version
    except (zipfile.BadZipFile, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('Invalid extension ZIP or manifest.') from exc


def _owner_only(handler, write=False):
    if not handler.admin_session():
        handler.send_json(401, {'error': 'Administrator sign-in required.'})
        return False
    if write and not handler.admin_write_authorized():
        handler.send_json(403, {'error': 'Invalid administrator session validation token.'})
        return False
    return True


def bundled_extension(root: Path) -> bytes:
    """Build an installable ZIP from GitHub-tracked extension sources."""
    source = root / 'extension' / '4writers'
    names = ('manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js', 'refresh.js', 'popup-refresh.js', 'order-card.js')
    if not all((source / name).is_file() for name in names):
        raise FileNotFoundError('Bundled extension source is missing from the deployment.')
    output = BytesIO()
    with zipfile.ZipFile(output, mode='w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in names:
            bundle.write(source / name, arcname=name)
    data = output.getvalue()
    validate_bundle(data)
    return data


def selected_bundle(database_path: Path, root: Path):
    """Serve the GitHub-tracked release, with legacy owner upload as fallback."""
    try:
        return bundled_extension(root), 'github-bundled'
    except FileNotFoundError:
        legacy = private_path(database_path, root)
        if legacy.is_file():
            return legacy.read_bytes(), 'owner-upload'
        raise



def status(handler, database_path: Path, root: Path):
    if not _owner_only(handler):
        return
    try:
        data, source = selected_bundle(database_path, root)
        version = validate_bundle(data)
    except (ValueError, OSError) as exc:
        return handler.send_json(500, {'error': str(exc)})
    return handler.send_json(200, {
        'available': True, 'version': version, 'sizeBytes': len(data),
        'source': source, 'sha256': hashlib.sha256(data).hexdigest(),
    })


def upload(handler, database_path: Path, root: Path):
    if not _owner_only(handler, write=True):
        return
    if handler.headers.get('Content-Type', '').split(';', 1)[0].lower() not in (
        'application/zip', 'application/octet-stream'):
        return handler.send_json(415, {'error': 'Upload a ZIP file.'})
    try:
        length = int(handler.headers.get('Content-Length', '0'))
    except ValueError:
        return handler.send_json(400, {'error': 'Invalid upload length.'})
    if length < 1 or length > MAX_ZIP_BYTES:
        return handler.send_json(413, {'error': 'Extension ZIP is limited to 2 MB.'})
    data = handler.rfile.read(length)
    if len(data) != length:
        return handler.send_json(400, {'error': 'Incomplete ZIP upload.'})
    try:
        version = validate_bundle(data)
    except ValueError as exc:
        return handler.send_json(400, {'error': str(exc)})
    path = private_path(database_path, root)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.parent / ('.extension-' + secrets.token_hex(10) + '.tmp')
    try:
        with open(temporary, 'xb') as handle:
            handle.write(data)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return handler.send_json(201, {
        'message': 'Private extension saved. Only a signed-in administrator can download it.',
        'version': version, 'sizeBytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
    })


def download(handler, database_path: Path, root: Path):
    if not _owner_only(handler):
        return
    try:
        data, source = selected_bundle(database_path, root)
        validate_bundle(data)
    except (ValueError, OSError) as exc:
        return handler.send_json(500, {'error': str(exc)})
    handler.send_response(200)
    handler.send_header('Content-Type', 'application/zip')
    handler.send_header('Content-Disposition', 'attachment; filename="' + BUNDLE_NAME + '"')
    handler.send_header('Content-Length', str(len(data)))
    handler.send_header('Cache-Control', 'private, no-store, max-age=0')
    handler.send_header('Pragma', 'no-cache')
    handler.end_headers()
    handler.wfile.write(data)


# Scoped extension reporting: never reuse the administrator cookie in an extension.
def ensure_report_tables(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS extension_report_token(
      id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL)""")
    connection.execute("""CREATE TABLE IF NOT EXISTS extension_claim_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      stage TEXT NOT NULL,
      elapsed_ms INTEGER,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL)""")


def create_report_token(handler, db_connection):
    if not _owner_only(handler, write=True):
        return
    token = secrets.token_urlsafe(36)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db_connection() as connection:
        ensure_report_tables(connection)
        connection.execute("DELETE FROM extension_report_token")
        connection.execute("INSERT INTO extension_report_token(id,token_hash,created_at) VALUES(1,?,?)",
                           (token_hash,datetime.now(timezone.utc).isoformat()))
    return handler.send_json(200, {
        'pairingCode': token,
        'message': 'Paste this private pairing code into your Chrome extension. The previous code is revoked.'
    })


def revoke_report_token(handler, db_connection):
    if not _owner_only(handler, write=True):
        return
    with db_connection() as connection:
        ensure_report_tables(connection)
        connection.execute("DELETE FROM extension_report_token")
    return handler.send_json(200, {'paired': False, 'message': 'Browser extension reporting access revoked.'})


def list_report_events(handler, db_connection):
    if not _owner_only(handler):
        return
    with db_connection() as connection:
        ensure_report_tables(connection)
        rows = connection.execute(
          "SELECT order_id,outcome,stage,elapsed_ms,detail,created_at FROM extension_claim_events "
          "ORDER BY id DESC LIMIT 100").fetchall()
        paired = connection.execute("SELECT 1 FROM extension_report_token WHERE id=1").fetchone() is not None
    return handler.send_json(200, {'paired': paired, 'events': [
        {'orderId': r['order_id'], 'outcome': r['outcome'], 'stage': r['stage'],
         'elapsedMs': r['elapsed_ms'], 'detail': r['detail'], 'createdAt': r['created_at']}
        for r in rows
    ]})


def receive_report(handler, db_connection):
    """Accept only result metadata, never credentials, order text, or client details."""
    auth = handler.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return handler.send_json(401, {'error': 'Extension pairing required.'})
    token = auth[7:]
    if len(token) < 30 or len(token) > 180:
        return handler.send_json(401, {'error': 'Invalid extension pairing.'})
    with db_connection() as connection:
        ensure_report_tables(connection)
        row = connection.execute("SELECT token_hash FROM extension_report_token WHERE id=1").fetchone()
    if not row or not secrets.compare_digest(row['token_hash'], hashlib.sha256(token.encode()).hexdigest()):
        return handler.send_json(401, {'error': 'Extension pairing was revoked or replaced.'})
    try:
        payload = handler.json_body()
        if not isinstance(payload, dict):
            raise ValueError('Invalid report body.')
        event_key = payload.get('eventKey')
        order_id = str(payload.get('orderId', ''))
        outcome = payload.get('outcome')
        stage = str(payload.get('stage', ''))[:60]
        detail = str(payload.get('detail', ''))[:400]
        elapsed = payload.get('elapsedMs')
        if not isinstance(event_key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{12,80}', event_key):
            raise ValueError('Invalid event identifier.')
        if not re.fullmatch(r'[0-9]{5,16}', order_id):
            raise ValueError('Invalid order identifier.')
        if outcome not in ('success', 'failure', 'uncertain'):
            raise ValueError('Invalid order result.')
        if not isinstance(elapsed, int) or not 0 <= elapsed <= 120000:
            raise ValueError('Invalid elapsed time.')
        if stage not in ('view','take','ok','acknowledge','result','timeout','security'):
            raise ValueError('Invalid workflow stage.')
    except ValueError as exc:
        return handler.send_json(400, {'error': str(exc)})
    with db_connection() as connection:
        ensure_report_tables(connection)
        connection.execute(
          "INSERT OR IGNORE INTO extension_claim_events(event_key,order_id,outcome,stage,elapsed_ms,detail,created_at) "
          "VALUES(?,?,?,?,?,?,?)",
          (event_key,order_id,outcome,stage,elapsed,detail,datetime.now(timezone.utc).isoformat()))
    return handler.send_json(202, {'received': True})


GOOD_WRITERS_BUNDLE_NAME = 'prowell-good-writers-assistant.zip'
GOOD_WRITERS_FILES = ('manifest.json','background.js','content.js','refresh.js',
                      'popup.html','popup.js','popup-refresh.js','order-card.js')


def good_writers_bundle(root: Path) -> bytes:
    """Build separate Good-Writers ZIP without touching the 4writers package."""
    source = root / 'extension' / 'good-writers'
    if not all((source / name).is_file() for name in GOOD_WRITERS_FILES):
        raise FileNotFoundError('Good-Writers extension source is missing from deployment.')
    output = BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in GOOD_WRITERS_FILES:
            bundle.write(source / name, arcname=name)
    data = output.getvalue()
    validate_bundle(data)
    with zipfile.ZipFile(BytesIO(data)) as bundle:
        manifest = json.loads(bundle.read('manifest.json'))
        if 'Good-Writers' not in manifest['name']:
            raise ValueError('Incorrect extension manifest.')
        if any('4writers.net' in str(s) for s in manifest.get('host_permissions', [])):
            raise ValueError('Good-Writers extension must be isolated.')
    return data


def good_writers_status(handler, root: Path):
    if not _owner_only(handler):
        return
    try:
        data=good_writers_bundle(root)
        version=validate_bundle(data)
    except (ValueError, OSError) as exc:
        return handler.send_json(500, {'error':str(exc)})
    return handler.send_json(200, {'available':True,'version':version,'sizeBytes':len(data),
                                   'source':'github-bundled','sha256':hashlib.sha256(data).hexdigest()})


def good_writers_download(handler, root: Path):
    if not _owner_only(handler):
        return
    try:
        data=good_writers_bundle(root)
    except (ValueError, OSError) as exc:
        return handler.send_json(500, {'error':str(exc)})
    handler.send_response(200)
    handler.send_header('Content-Type','application/zip')
    handler.send_header('Content-Disposition','attachment; filename="' + GOOD_WRITERS_BUNDLE_NAME + '"')
    handler.send_header('Content-Length',str(len(data)))
    handler.send_header('Cache-Control','private, no-store, max-age=0')
    handler.send_header('Pragma','no-cache')
    handler.end_headers()
    handler.wfile.write(data)
