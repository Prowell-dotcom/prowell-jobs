"""Private, moderated Prowell marketplace for ethical writing and tutoring services.

Uses existing Prowell member/admin sessions and SQLite. No paid work/escrow is
implemented. Uploaded deliverables remain private until admin approval.
"""
from __future__ import annotations
import base64
import binascii
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

CATEGORIES = (
 'Proofreading & Editing','Academic Tutoring','Research Coaching',
 'Citation & Referencing Review','Data Analysis Support','Literature Review Guidance',
 'CVs & Cover Letters','Business Writing','Website Content','Copywriting',
 'Translation & Transcription','Other Permitted Writing',
)
# Bounded uploads. Never accept arbitrary executables or unlimited files.
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_ATTACHMENTS = 5
MAX_TOTAL_BYTES = 60 * 1024 * 1024
ALLOWED_EXTENSIONS = {
 '.pdf':'application/pdf',
 '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 '.txt':'text/plain', '.md':'text/plain', '.csv':'text/csv',
 '.rtf':'application/rtf', '.odt':'application/vnd.oasis.opendocument.text',
 '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp',
 '.mp3':'audio/mpeg', '.wav':'audio/wav', '.mp4':'video/mp4',
}



def init_db(db):
    db.execute('''CREATE TABLE IF NOT EXISTS writing_orders (
        id TEXT PRIMARY KEY, clientId TEXT NOT NULL, title TEXT NOT NULL,
        category TEXT NOT NULL, brief TEXT NOT NULL, deadline TEXT NOT NULL,
        budgetKES INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        chosenBidId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)''')
    # Additive migration: preserve existing live orders and uploaded deliverables.
    columns={r[1] for r in db.execute('PRAGMA table_info(writing_orders)').fetchall()}
    if 'publicSummary' not in columns:
        db.execute('ALTER TABLE writing_orders ADD COLUMN publicSummary TEXT')
    db.execute('''CREATE TABLE IF NOT EXISTS writing_order_files (
        id TEXT PRIMARY KEY, orderId TEXT NOT NULL, uploadedBy TEXT NOT NULL,
        storedName TEXT NOT NULL, originalName TEXT NOT NULL, mimeType TEXT NOT NULL,
        fileSize INTEGER NOT NULL, createdAt TEXT NOT NULL)''')
    if 'assignedBy' not in columns:
        db.execute('ALTER TABLE writing_orders ADD COLUMN assignedBy TEXT')
    db.execute('''CREATE TABLE IF NOT EXISTS writing_assignment_audit (
        id TEXT PRIMARY KEY, orderId TEXT NOT NULL, bidId TEXT NOT NULL,
        assignedBy TEXT NOT NULL, createdAt TEXT NOT NULL)''')
    db.execute('CREATE INDEX IF NOT EXISTS idx_writing_order_files_order ON writing_order_files(orderId)')
    db.execute('''CREATE TABLE IF NOT EXISTS writing_bids (
        id TEXT PRIMARY KEY, orderId TEXT NOT NULL, writerId TEXT NOT NULL,
        amountKES INTEGER NOT NULL, days INTEGER NOT NULL, proposal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', createdAt TEXT NOT NULL,
        UNIQUE(orderId,writerId))''')
    db.execute('''CREATE TABLE IF NOT EXISTS writing_deliverables (
        id TEXT PRIMARY KEY,orderId TEXT NOT NULL, writerId TEXT NOT NULL,
        storedName TEXT NOT NULL,originalName TEXT NOT NULL,mimeType TEXT NOT NULL,
        fileSize INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL, reviewedAt TEXT)''')
    db.execute('CREATE INDEX IF NOT EXISTS idx_writing_bids_order ON writing_bids(orderId)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_writing_deliverables_order ON writing_deliverables(orderId,createdAt)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_writing_orders_client ON writing_orders(clientId)')
    db.execute('''CREATE TABLE IF NOT EXISTS writing_messages (
        id TEXT PRIMARY KEY, orderId TEXT NOT NULL, senderId TEXT NOT NULL,
        body TEXT NOT NULL, createdAt TEXT NOT NULL)''')
    db.execute('CREATE INDEX IF NOT EXISTS idx_writing_messages_order ON writing_messages(orderId,createdAt)')


def parse_text(payload, key, maximum, required=True):
    value=payload.get(key,'')
    if not isinstance(value,str):raise ValueError(f'{key} must be text.')
    value=value.strip()
    if required and not value:raise ValueError(f'{key} is required.')
    if len(value)>maximum:raise ValueError(f'{key} is too long.')
    return value


def utc(): return datetime.now(timezone.utc).isoformat()


def validate_file(name, encoded):
    name=parse_text({'name':name},'name',150)
    name=Path(name.replace('\\','/')).name
    if not name or name.startswith('.') or any(ord(ch)<32 for ch in name):
        raise ValueError('Choose a valid file name.')
    suffix=Path(name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError('Unsupported file type. Use PDF, Office documents, text, images or supported media; executables and scripts are not accepted.')
    if not isinstance(encoded,str) or len(encoded)>4*((MAX_FILE_BYTES+2)//3)+8:
        raise ValueError('File exceeds the 20 MB maximum.')
    try: blob=base64.b64decode(encoded,validate=True)
    except (binascii.Error,ValueError):raise ValueError('Invalid file encoding.')
    if not blob or len(blob)>MAX_FILE_BYTES:
        raise ValueError('File is empty or too large (max 20 MB).')
    if suffix=='.pdf' and not blob.startswith(b'%PDF-'):
        raise ValueError('This is not a valid PDF file.')
    if suffix in ('.txt','.md','.csv'):
        try: blob.decode('utf-8-sig')
        except UnicodeDecodeError:raise ValueError('Text and CSV files must use UTF-8 encoding.')
        if b'\x00' in blob:raise ValueError('Text files cannot contain binary data.')
    if suffix=='.rtf' and not blob.startswith(b'{\\rtf'):
        raise ValueError('Invalid RTF file.')
    if suffix in ('.docx','.xlsx','.pptx','.odt'):
        required={'.docx':'word/document.xml','.xlsx':'xl/workbook.xml',
                  '.pptx':'ppt/presentation.xml','.odt':'content.xml'}[suffix]
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                names=set(archive.namelist())
                if required not in names or (suffix!='.odt' and '[Content_Types].xml' not in names):
                    raise ValueError('Invalid Office document format.')
                files=archive.infolist()
                if len(files)>1500 or sum(x.file_size for x in files)>100*1024*1024:
                    raise ValueError('Document archive exceeds safe expansion limits.')
                if any('vbaproject.bin' in x.lower() for x in names):
                    raise ValueError('Macro-enabled documents are not allowed.')
        except (zipfile.BadZipFile,RuntimeError):raise ValueError('Invalid Office document archive.')
    if suffix in ('.jpg','.jpeg') and not blob.startswith(b'\xff\xd8\xff'):
        raise ValueError('Invalid JPEG image.')
    if suffix=='.png' and not blob.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Invalid PNG image.')
    if suffix=='.webp' and not (blob.startswith(b'RIFF') and blob[8:12]==b'WEBP'):
        raise ValueError('Invalid WebP image.')
    if suffix=='.wav' and not (blob.startswith(b'RIFF') and blob[8:12]==b'WAVE'):
        raise ValueError('Invalid WAV recording.')
    if suffix=='.mp3' and not (blob.startswith(b'ID3') or (blob[0]==255 and blob[1]&224==224)):
        raise ValueError('Invalid MP3 audio.')
    if suffix=='.mp4' and not blob[4:8]==b'ftyp':
        raise ValueError('Invalid MP4 video.')
    return name, ALLOWED_EXTENSIONS[suffix],blob


def _private_root(h):
    # Place outside the served website tree; Railway DATABASE_PATH should be under /data.
    root=h.writing_upload_root
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    return root


class Marketplace:
    def __init__(self,h,db_context,deliver,wake,check_rate,upload_root):
        self.h=h; self.db=db_context; self.deliver=deliver; self.wake=wake
        self.rate=check_rate;h.writing_upload_root=upload_root

    def error(self,code,msg):return self.h.send_json(code,{'error':msg})

    def _get_session(self,role=None,write=False):
        s=self.h._member_session()
        if not s:return None,'Please log in to your free Prowell Jobs account.'
        if role and s['role'] not in role:return None,'This action requires a '+('writer' if role=={'writer','jobseeker'} else 'client')+' account.'
        if write and not self.h._member_write_ok(s):return None,'Invalid session validation token.'
        if write and not s['emailVerified']:return None,'Please verify your email address first.'
        return s,None

    def _notify(self,db,to,subject,body,kind,ref,event_ids):
        # Existing outbox worker and tested Resend adapter manage delivery/retries.
        if not to or '@' not in to:return
        eid='writing:'+ref+':'+kind+':'+str(uuid.uuid4())
        db.execute('''INSERT INTO notification_outbox(eventId,jobId,kind,channel,recipient,subject,body,status,createdAt)
                     VALUES(?,?,?,?,?,?,?,'pending',?)''',
                   (eid,ref,kind,'email',to,subject,body,utc()))
        event_ids.append(eid)

    def _dispatch_emails(self,events):
        for eid in events:
            try:self.deliver(eid)
            except Exception:pass  # Outbox retry worker retains the delivery attempt.
        if events:self.wake.set()

    def _orders_public(self):
        sess,err=self._get_session()
        if err:return self.error(401,err)
        with self.db() as db:
            rows=db.execute('''SELECT id,title,category,COALESCE(publicSummary,'') AS publicSummary,deadline,budgetKES,createdAt
                FROM writing_orders WHERE status='open' ORDER BY createdAt DESC LIMIT 100''').fetchall()
        return self.h.send_json(200,{'orders':[dict(r) for r in rows], 'categories':CATEGORIES})

    def _order_detail(self,order_id):
        """Full private instructions are visible only to the client or selected writer."""
        sess,err=self._get_session()
        if err:return self.error(401,err)
        with self.db() as db:
            row=db.execute('''SELECT o.*,b.writerId AS selectedWriterId FROM writing_orders o
                LEFT JOIN writing_bids b ON b.id=o.chosenBidId WHERE o.id=?''',(order_id,)).fetchone()
            if not row:return self.error(404,'Order not found.')
            if sess['id'] not in (row['clientId'],row['selectedWriterId']):
                return self.error(403,'Instructions unlock only for the client and the selected writer.')
            files=db.execute('SELECT id,originalName,fileSize FROM writing_order_files WHERE orderId=? ORDER BY createdAt',(order_id,)).fetchall()
            return self.h.send_json(200,{'order':{k:row[k] for k in ('id','title','category','brief','deadline','budgetKES','status','publicSummary')},'attachments':[dict(f) for f in files]})

    def _instruction_file_download(self,file_id,admin=False):
        sess=None if admin else self.h._member_session()
        if admin:
            if not self.h.authorized():return self.error(401,'Admin access required.')
        elif not sess:return self.error(401,'Sign in to access project instructions.')
        with self.db() as db:
            file=db.execute('''SELECT f.*,o.clientId,b.writerId AS selectedWriterId FROM writing_order_files f
                JOIN writing_orders o ON o.id=f.orderId
                LEFT JOIN writing_bids b ON b.id=o.chosenBidId WHERE f.id=?''',(file_id,)).fetchone()
        if not file:return self.error(404,'Attachment not found.')
        if not admin and sess['id'] not in (file['clientId'],file['selectedWriterId']):
            return self.error(403,'Only the project owner and chosen writer can download instructions.')
        target=_private_root(self.h)/file['storedName']
        if not target.is_file():return self.error(404,'Attachment unavailable.')
        blob=target.read_bytes()
        safe_name=re.sub('[^A-Za-z0-9._-]','_',file['originalName'])
        self.h.send_response(200)
        self.h.send_header('Content-Type',file['mimeType'])
        self.h.send_header('Content-Disposition',f'attachment; filename="{safe_name}"')
        self.h.send_header('Content-Length',str(len(blob)))
        self.h.send_header('Cache-Control','private, no-store')
        self.h.send_header('X-Content-Type-Options','nosniff')
        self.h.end_headers();self.h.wfile.write(blob)

    def _my(self):
        s,err=self._get_session()
        if err:return self.error(401,err)
        with self.db() as db:
            orders=db.execute('SELECT * FROM writing_orders WHERE clientId=? ORDER BY createdAt DESC LIMIT 100',(s['id'],)).fetchall()
            assignments=db.execute('''SELECT o.id,o.title,o.category,o.deadline,o.budgetKES,o.status,o.createdAt
                FROM writing_orders o JOIN writing_bids b ON b.id=o.chosenBidId
                WHERE b.writerId=? ORDER BY o.createdAt DESC''',(s['id'],)).fetchall()
            my_bids=db.execute('''SELECT b.id,b.orderId,b.amountKES,b.days,b.status,o.title,o.status AS orderStatus
                FROM writing_bids b JOIN writing_orders o ON o.id=b.orderId
                WHERE b.writerId=? ORDER BY b.createdAt DESC''',(s['id'],)).fetchall()
            uploads=db.execute('''SELECT d.id,d.orderId,d.originalName,d.status,d.createdAt
                FROM writing_deliverables d JOIN writing_orders o ON o.id=d.orderId
                WHERE o.clientId=? OR d.writerId=? ORDER BY d.createdAt DESC LIMIT 100''',(s['id'],s['id'])).fetchall()
        return self.h.send_json(200,{'orders':[dict(x) for x in orders], 'assignments':[dict(x) for x in assignments],
                                     'bids':[dict(x) for x in my_bids], 'deliverables':[dict(x) for x in uploads]})

    def _bids(self,order_id):
        s,err=self._get_session()
        if err:return self.error(401,err)
        with self.db() as db:
            order=db.execute('SELECT clientId FROM writing_orders WHERE id=?',(order_id,)).fetchone()
            if not order:return self.error(404,'Order not found.')
            if order['clientId']!=s['id']:return self.error(403,'Only the order owner can see bids.')
            bids=db.execute('''SELECT b.id,b.amountKES,b.days,b.proposal,b.status,b.createdAt,m.fullName AS writerName
                FROM writing_bids b JOIN members m ON m.id=b.writerId WHERE b.orderId=? ORDER BY b.amountKES ASC''', (order_id,)).fetchall()
        return self.h.send_json(200,{'bids':[dict(x) for x in bids]})

    def _cancel_order(self,order_id):
        sess,err=self._get_session(write=True)
        if err:return self.error(401 if not sess else 403,err)
        if not self.rate(self.h.client_address[0],'writing-cancel',15):return self.error(429,'Too many attempts.')
        events=[]
        with self.db() as db:
            order=db.execute('SELECT clientId,title,status FROM writing_orders WHERE id=?',(order_id,)).fetchone()
            if not order:return self.error(404,'Writing order not found.')
            if order['clientId']!=sess['id']:return self.error(403,'Only the customer can cancel their own open order.')
            if order['status']!='open':return self.error(409,'Assigned or completed projects cannot be cancelled here. Contact support.')
            done=db.execute("UPDATE writing_orders SET status='cancelled',updatedAt=? WHERE id=? AND status='open'",(utc(),order_id))
            if not done.rowcount:return self.error(409,'This order is no longer open.')
            bidders=db.execute('SELECT DISTINCT m.email FROM writing_bids b JOIN members m ON m.id=b.writerId WHERE b.orderId=?',(order_id,)).fetchall()
            for writer in bidders:
                self._notify(db,writer['email'],'Writing request cancelled — Prowell Jobs',
                    f'The customer cancelled the open request "{order["title"]}". No writer was assigned.',
                    'writing_order_cancelled',order_id,events)
        self._dispatch_emails(events)
        return self.h.send_json(200,{'message':'Order cancelled. It is no longer open for bids.'})

    def _messages(self,order_id,posting=False,admin=False):
        sess=None if admin else self.h._member_session()
        if admin:
            if not self.h.authorized():return self.error(401,'Administrator sign-in required.')
        elif not sess:return self.error(401,'Please sign in.')
        if posting:
            if not self.h._member_write_ok(sess):return self.error(403,'Invalid session token.')
            if not sess['emailVerified']:return self.error(403,'Verify your email before sending messages.')
            if not self.rate(self.h.client_address[0],'writing-message',40):return self.error(429,'Too many messages. Please try later.')
            try:
                data=self.h.json_body()
                body=parse_text(data,'body',2500)
                if len(body)<2:raise ValueError('Enter a message of at least two characters.')
            except ValueError as exc:return self.error(400,str(exc))
        events=[]
        with self.db() as db:
            order=db.execute('''SELECT o.id,o.title,o.clientId,o.status,b.writerId AS chosenWriter
                FROM writing_orders o LEFT JOIN writing_bids b ON b.id=o.chosenBidId WHERE o.id=?''',(order_id,)).fetchone()
            if not order:return self.error(404,'Writing order not found.')
            if order['status'] not in ('assigned','submitted','delivered'):
                return self.error(409,'Messages are available once a writer is selected.')
            if not admin and sess['id'] not in (order['clientId'],order['chosenWriter']):
                return self.error(403,'Only the customer and selected writer can read this conversation.')
            if posting:
                mid=str(uuid.uuid4())
                db.execute('INSERT INTO writing_messages(id,orderId,senderId,body,createdAt) VALUES(?,?,?,?,?)',
                    (mid,order_id,sess['id'],body,utc()))
                receiver_id=order['chosenWriter'] if sess['id']==order['clientId'] else order['clientId']
                receiver=db.execute('SELECT email FROM members WHERE id=?',(receiver_id,)).fetchone()
                if receiver:
                    self._notify(db,receiver['email'],'New private project message — Prowell Jobs',
                       f'There is a new message on project "{order["title"]}". Sign in to read it securely: https://prowelljobs.com/writing.html',
                       'writing_message',order_id,events)
            rows=db.execute('''SELECT m.id,m.body,m.createdAt,m.senderId,a.fullName AS senderName
                FROM writing_messages m JOIN members a ON a.id=m.senderId
                WHERE m.orderId=? ORDER BY m.createdAt ASC,m.id ASC LIMIT 300''',(order_id,)).fetchall()
        self._dispatch_emails(events)
        return self.h.send_json(201 if posting else 200,{'messages':[dict(row) for row in rows],
            'message':'Private project message sent.' if posting else 'Private project conversation.'})

    def _create_order(self):
        sess,err=self._get_session(write=True)
        if err:return self.error(401 if not sess else 403,err)
        if not self.rate(self.h.client_address[0],'writing-order',7):return self.error(429,'Too many orders; try again later.')
        try:
            # A bounded JSON envelope prevents untrusted uploads from exhausting memory.
            length=int(self.h.headers.get('Content-Length','0'))
            if not 0<length<=85_000_000:return self.error(413,'Order upload exceeds the 60 MB combined document limit.')
            data=json.loads(self.h.rfile.read(length))
            title=parse_text(data,'title',150)
            category=parse_text(data,'category',80)
            public_summary=parse_text(data,'publicSummary',600,False) or (title+' — details shared privately after writer selection.')
            brief=parse_text(data,'brief',8000)
            deadline=parse_text(data,'deadline',10)
            budget=int(data.get('budgetKES',0))
            if category not in CATEGORIES:raise ValueError('Choose a valid writing service.')
            if len(public_summary)<25 or len(brief)<25:raise ValueError('Describe the public summary and full instructions.')
            if not 0<=budget<=10000000:raise ValueError('Enter a valid budget.')
            datetime.strptime(deadline,'%Y-%m-%d')
            if deadline < datetime.now(timezone.utc).strftime('%Y-%m-%d'):raise ValueError('Deadline must be today or later.')
            if data.get('integrityConsent') is not True:
                raise ValueError('Confirm that this work is permitted writing support.')
            attachments=data.get('attachments',[])
            if not isinstance(attachments,list) or len(attachments)>MAX_ATTACHMENTS:raise ValueError('Up to five supporting documents are allowed.')
            prepared=[]
            for raw in attachments:
                if not isinstance(raw,dict):raise ValueError('Invalid attachment metadata.')
                prepared.append(validate_file(raw.get('filename',''),raw.get('contentBase64','')))
            if sum(len(f[2]) for f in prepared)>MAX_TOTAL_BYTES:
                raise ValueError('Combined attachments must be under 60 MB.')
        except (ValueError,TypeError,json.JSONDecodeError,UnicodeDecodeError) as exc:
            return self.error(400,str(exc))
        oid=str(uuid.uuid4());now=utc(); events=[];saved=[]
        try:
            with self.db() as db:
                db.execute('''INSERT INTO writing_orders(id,clientId,title,category,brief,deadline,
                    budgetKES,status,createdAt,updatedAt,publicSummary)
                    VALUES(?,?,?,?,?,?,?,'open',?,?,?)''',
                    (oid,sess['id'],title,category,brief,deadline,budget,now,now,public_summary))
                if prepared:
                    root=_private_root(self.h)
                    for name,mime,blob in prepared:
                        fid=str(uuid.uuid4());storage=fid+Path(name).suffix.lower()
                        target=root/storage
                        with open(target,'xb') as out:out.write(blob)
                        os.chmod(target,0o600)
                        saved.append(target)
                        db.execute('''INSERT INTO writing_order_files
                            (id,orderId,uploadedBy,storedName,originalName,mimeType,fileSize,createdAt)
                            VALUES(?,?,?,?,?,?,?,?)''',
                            (fid,oid,sess['id'],storage,name,mime,len(blob),now))
                self._notify(db,sess['email'],'Prowell Writing — order submitted',
                    f'Your request "{title}" is available for writer bidding. The full instructions and uploaded files remain private until you select a writer.\nhttps://prowelljobs.com/dashboard.html',
                    'writing_order_receipt',oid,events)
                self._notify(db,os.getenv('ADMIN_NOTIFICATION_EMAIL','prowellofficial@gmail.com'),
                    'New writing request — Prowell Jobs',
                    f'A writing support project "{title}" is open for bids. Review from the private admin page.',
                    'writing_order_admin',oid,events)
        except Exception:
            for file in saved:file.unlink(missing_ok=True)
            raise
        self._dispatch_emails(events)
        return self.h.send_json(201,{'message':'Order posted for members to bid. Private instructions are locked until you choose a writer.','id':oid})

    def _bid(self,order_id):
        s,err=self._get_session(write=True)
        if err:return self.error(401 if not s else 403,err)
        if not self.rate(self.h.client_address[0],'writing-bid',15):return self.error(429,'Too many bids; try again later.')
        try:
            data=self.h.json_body();amount=int(data.get('amountKES',-1));days=int(data.get('days',0))
            proposal=parse_text(data,'proposal',1200)
            if not 0<=amount<=10000000 or not 1<=days<=120 or len(proposal)<20:raise ValueError('Invalid bid values.')
        except (ValueError,TypeError):return self.error(400,'Enter a proposal (20+ characters), amount, and completion days.')
        bid_id=str(uuid.uuid4());events=[]
        with self.db() as db:
            order=db.execute('SELECT * FROM writing_orders WHERE id=?',(order_id,)).fetchone()
            if not order:return self.error(404,'Request not found.')
            if order['status']!='open':return self.error(409,'Bidding is closed.')
            if order['clientId']==s['id']:return self.error(403,'You cannot bid on your own request.')
            try:db.execute('''INSERT INTO writing_bids(id,orderId,writerId,amountKES,days,proposal,createdAt)
                        VALUES(?,?,?,?,?,?,?)''',(bid_id,order_id,s['id'],amount,days,proposal,utc()))
            except sqlite3.IntegrityError:return self.error(409,'You have already bid on this request.')
            client=db.execute('SELECT email FROM members WHERE id=?',(order['clientId'],)).fetchone()
            self._notify(db,client['email'],'A writer submitted a proposal — Prowell Jobs',
                 f'Your request "{order["title"]}" has a new bid. Sign in to compare proposals.\nhttps://prowelljobs.com/writing.html',
                 'writing_new_bid',order_id,events)
        self._dispatch_emails(events)
        return self.h.send_json(201,{'message':'Your proposal was submitted to the client.','id':bid_id})

    def _assign_bid(self,order_id,bid_id,actor,direct_writer_id=None):
        # Centralized assignment guarantees that client/admin cannot choose two writers.
        events=[]
        with self.db() as db:
            order=db.execute('SELECT * FROM writing_orders WHERE id=?',(order_id,)).fetchone()
            if not order:return self.error(404,'Request not found.')
            if actor!='administrator' and order['clientId']!=actor:
                return self.error(403,'Only the client or administrator can select a writer.')
            if order['status']!='open':return self.error(409,'This request already has a selected writer.')
            if direct_writer_id is not None:
                writer=db.execute('''SELECT id,email,fullName,role,emailVerified FROM members WHERE id=?''',
                                  (direct_writer_id,)).fetchone()
                if not writer or writer['role'] not in ('writer','jobseeker') or not writer['emailVerified']:
                    return self.error(400,'Choose a verified registered writer or job seeker.')
                existing=db.execute('''SELECT id FROM writing_bids WHERE orderId=? AND writerId=?''',
                                    (order_id,direct_writer_id)).fetchone()
                if existing:
                    bid_id=existing['id']
                else:
                    bid_id=str(uuid.uuid4())
                    due=(datetime.strptime(order['deadline'],'%Y-%m-%d').date()-datetime.now(timezone.utc).date()).days
                    db.execute('''INSERT INTO writing_bids(id,orderId,writerId,amountKES,days,proposal,createdAt)
                        VALUES(?,?,?,?,?,?,?)''',
                        (bid_id,order_id,direct_writer_id,order['budgetKES'],max(1,min(120,due)),
                         'Direct assignment made by Prowell Jobs administrator.',utc()))
            bid=db.execute('''SELECT b.*,m.email,m.fullName FROM writing_bids b
                JOIN members m ON m.id=b.writerId WHERE b.id=? AND b.orderId=?''',(bid_id,order_id)).fetchone()
            if not bid:return self.error(404,'That writer has not bid on this request.')
            update=db.execute("UPDATE writing_orders SET status='assigned',chosenBidId=?,assignedBy=?,updatedAt=? WHERE id=? AND status='open'",(bid_id,actor,utc(),order_id))
            if not update.rowcount:return self.error(409,'A writer has already been assigned.')
            db.execute("UPDATE writing_bids SET status=CASE WHEN id=? THEN 'selected' ELSE 'not_selected' END WHERE orderId=?",
                       (bid_id,order_id))
            db.execute('INSERT INTO writing_assignment_audit VALUES (?,?,?,?,?)',
                       (str(uuid.uuid4()),order_id,bid_id,actor,utc()))
            client=db.execute('SELECT email FROM members WHERE id=?',(order['clientId'],)).fetchone()
            self._notify(db,bid['email'],'You were selected — Prowell Writing',
                f'You have been selected for "{order["title"]}". Log in to access the private instructions and supporting files.\nhttps://prowelljobs.com/writing.html',
                'writing_bid_selected',order_id,events)
            if client:
                selection=('Prowell Jobs administration' if actor=='administrator' else 'You')
                self._notify(db,client['email'],'Writer selected for your Prowell Writing project',
                    f'{selection} selected {bid["fullName"]} for "{order["title"]}". The selected writer can now access your private instructions and start work.\nhttps://prowelljobs.com/writing.html',
                    'writing_writer_assigned',order_id,events)
        self._dispatch_emails(events)
        return self.h.send_json(200,{'message':'Writer assigned. Only this writer can now view the instructions and upload work for administrator approval.'})

    def _choose(self,order_id):
        s,err=self._get_session({'client','employer'},True)
        if err:return self.error(401 if not s else 403,err)
        try:data=self.h.json_body();bid_id=parse_text(data,'bidId',70)
        except ValueError as exc:return self.error(400,str(exc))
        return self._assign_bid(order_id,bid_id,s['id'])

    def _admin_bids(self,order_id):
        if not self.h.authorized():return self.error(401,'Admin access required.')
        with self.db() as db:
            row=db.execute('SELECT id,title,status FROM writing_orders WHERE id=?',(order_id,)).fetchone()
            if not row:return self.error(404,'Request not found.')
            bids=db.execute('''SELECT b.id,b.orderId,b.amountKES,b.days,b.proposal,b.status,b.createdAt,
                m.fullName AS writerName,m.email AS writerEmail FROM writing_bids b
                JOIN members m ON m.id=b.writerId WHERE b.orderId=? ORDER BY b.createdAt''',(order_id,)).fetchall()
        return self.h.send_json(200,{'order':dict(row),'bids':[dict(x) for x in bids]})

    def _admin_writers(self):
        if not self.h.authorized():return self.error(401,'Administrator login required.')
        with self.db() as db:
            writers=db.execute('''SELECT id,fullName,email,role FROM members
                WHERE role IN ('writer','jobseeker') AND emailVerified=1
                ORDER BY fullName COLLATE NOCASE,id LIMIT 1000''').fetchall()
        return self.h.send_json(200,{'writers':[dict(w) for w in writers]})

    def _admin_direct_assign(self,order_id):
        if not self.h.authorized():return self.error(401,'Administrator login required.')
        if not self.h.admin_write_authorized():return self.error(403,'Invalid administrator validation token.')
        try:
            data=self.h.json_body(); writer_id=parse_text(data,'writerId',70)
        except ValueError as exc:return self.error(400,str(exc))
        return self._assign_bid(order_id,None,'administrator',direct_writer_id=writer_id)

    def _admin_choose(self,order_id):
        if not self.h.authorized():return self.error(401,'Admin access required.')
        if not self.h.admin_write_authorized():return self.error(403,'Invalid admin session validation token.')
        try:data=self.h.json_body();bid_id=parse_text(data,'bidId',70)
        except ValueError as exc:return self.error(400,str(exc))
        return self._assign_bid(order_id,bid_id,'administrator')

    def _upload(self,order_id):
        s,err=self._get_session(write=True)
        if err:return self.error(401 if not s else 403,err)
        if not self.rate(self.h.client_address[0],'writing-upload',12):return self.error(429,'Too many uploads; try again later.')
        try:
            length=int(self.h.headers.get('Content-Length','0'))
            if not 0<length<=28_500_000:return self.error(413,'File is too large (max 20 MB).')
            data=json.loads(self.h.rfile.read(length))
            name,mime,blob=validate_file(data.get('filename',''),data.get('contentBase64',''))
        except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError) as exc:
            return self.error(400,str(exc))
        root=_private_root(self.h);file_id=str(uuid.uuid4());saved=file_id+Path(name).suffix.lower()
        events=[]
        with self.db() as db:
            order=db.execute('''SELECT o.*,b.writerId FROM writing_orders o
                 LEFT JOIN writing_bids b ON b.id=o.chosenBidId WHERE o.id=?''',(order_id,)).fetchone()
            if not order:return self.error(404,'Request not found.')
            if order['writerId']!=s['id'] or order['status']!='assigned':
                return self.error(403,'Only the selected writer can upload this work.')
            # Write after role check, never into the public website directory.
            target=root/saved
            try:
                with open(target,'xb') as f:f.write(blob)
                os.chmod(target,0o600)
                db.execute('''INSERT INTO writing_deliverables
                   (id,orderId,writerId,storedName,originalName,mimeType,fileSize,createdAt)
                   VALUES(?,?,?,?,?,?,?,?)''',(file_id,order_id,s['id'],saved,name,mime,len(blob),utc()))
                db.execute("UPDATE writing_orders SET status='submitted',updatedAt=? WHERE id=?",(utc(),order_id))
            except Exception:
                target.unlink(missing_ok=True)
                raise
            admin=os.getenv('ADMIN_NOTIFICATION_EMAIL','prowellofficial@gmail.com')
            self._notify(db,admin,'Work submitted for admin review — Prowell Writing',
                 f'A writer has uploaded a file for "{order["title"]}". Please review and approve or reject in your dashboard: https://prowelljobs.com/writing-admin.html',
                 'writing_file_admin',order_id,events)
            client=db.execute('SELECT email FROM members WHERE id=?',(order['clientId'],)).fetchone()
            self._notify(db,client['email'],'Your writing request has a submission awaiting review',
                 f'The writer submitted a file for "{order["title"]}". It is not downloadable until Prowell Jobs completes its review.',
                 'writing_file_pending',order_id,events)
        self._dispatch_emails(events)
        return self.h.send_json(201,{'message':'Uploaded privately for administrator review. The client cannot download it yet.'})

    def _file_download(self,file_id,admin=False):
        s=None if admin else self.h._member_session()
        if admin:
            if not self.h.authorized():return self.error(401,'Admin access required.')
        elif not s:return self.error(401,'Log in to download your approved document.')
        with self.db() as db:
            r=db.execute('''SELECT d.*,o.clientId FROM writing_deliverables d
                 JOIN writing_orders o ON o.id=d.orderId WHERE d.id=?''',(file_id,)).fetchone()
        if not r:return self.error(404,'File not found.')
        if not admin and (r['clientId']!=s['id'] or r['status']!='approved'):
            return self.error(403,'This file is not approved or does not belong to your order.')
        target=_private_root(self.h)/r['storedName']
        if not target.is_file():return self.error(404,'File storage unavailable.')
        blob=target.read_bytes()
        safe_name=re.sub('[^A-Za-z0-9._-]','_',r['originalName'])
        self.h.send_response(200)
        self.h.send_header('Content-Type',r['mimeType'])
        self.h.send_header('Content-Disposition',f'attachment; filename="{safe_name}"')
        self.h.send_header('Content-Length',str(len(blob)))
        self.h.send_header('Cache-Control','no-store, private')
        self.h.end_headers();self.h.wfile.write(blob)

    def _admin_orders(self):
        if not self.h.authorized():return self.error(401,'Admin access required.')
        with self.db() as db:
            rows=db.execute('''SELECT o.*,m.fullName AS clientName,
                (SELECT COUNT(*) FROM writing_bids b WHERE b.orderId=o.id) AS bidCount
                FROM writing_orders o JOIN members m ON m.id=o.clientId ORDER BY o.createdAt DESC LIMIT 250''').fetchall()
            files=db.execute('''SELECT id,orderId,originalName,fileSize,status,createdAt FROM writing_deliverables
              ORDER BY createdAt DESC LIMIT 250''').fetchall()
            attachments=db.execute('''SELECT id,orderId,originalName,fileSize,createdAt FROM writing_order_files
              ORDER BY createdAt DESC LIMIT 250''').fetchall()
        return self.h.send_json(200,{'orders':[dict(x) for x in rows], 'files':[dict(x) for x in files], 'attachments':[dict(x) for x in attachments]})

    def _review(self,order_id):
        if not self.h.authorized():return self.error(401,'Admin access required.')
        if not self.h.admin_write_authorized():return self.error(403,'Invalid administrator validation token.')
        try:data=self.h.json_body();file_id=parse_text(data,'fileId',70);decision=parse_text(data,'decision',16)
        except ValueError as exc:return self.error(400,str(exc))
        if decision not in ('approve','reject'):return self.error(400,'Choose approve or reject.')
        events=[]
        with self.db() as db:
            r=db.execute('''SELECT d.*,o.clientId,o.title,o.status AS orderStatus
                FROM writing_deliverables d JOIN writing_orders o ON o.id=d.orderId
                WHERE d.id=? AND o.id=?''',(file_id,order_id)).fetchone()
            if not r:return self.error(404,'Submission not found.')
            if r['status']!='pending':return self.error(409,'This submission was already reviewed.')
            if r['orderStatus']!='submitted':return self.error(409,'Order is not awaiting review.')
            latest=db.execute('SELECT id FROM writing_deliverables WHERE orderId=? ORDER BY createdAt DESC,id DESC LIMIT 1',(order_id,)).fetchone()
            if latest and latest['id']!=file_id:return self.error(409,'Only the latest submission can be reviewed.')
            if decision=='approve':
                changed=db.execute("UPDATE writing_deliverables SET status='approved',reviewedAt=? WHERE id=? AND status='pending'",(utc(),file_id))
                if not changed.rowcount:return self.error(409,'Already reviewed.')
                db.execute("UPDATE writing_orders SET status='delivered',updatedAt=? WHERE id=?",(utc(),order_id))
            else:
                changed=db.execute("UPDATE writing_deliverables SET status='rejected',reviewedAt=? WHERE id=? AND status='pending'",(utc(),file_id))
                if not changed.rowcount:return self.error(409,'Already reviewed.')
                db.execute("UPDATE writing_orders SET status='assigned',updatedAt=? WHERE id=?",(utc(),order_id))
            client=db.execute('SELECT email FROM members WHERE id=?',(r['clientId'],)).fetchone()
            writer=db.execute('SELECT email FROM members WHERE id=?',(r['writerId'],)).fetchone()
            if decision=='approve':
                self._notify(db,client['email'],'Your reviewed file is ready — Prowell Writing',
                    f'Your order "{r["title"]}" has a reviewed file ready. Log in to download it securely.\nhttps://prowelljobs.com/writing.html',
                    'writing_file_approved',order_id,events)
            else:
                self._notify(db,writer['email'],'Revision requested — Prowell Writing',
                    f'The submitted file for "{r["title"]}" was not approved. Review the requirements and upload a corrected document.',
                    'writing_file_rejected',order_id,events)
        self._dispatch_emails(events)
        return self.h.send_json(200,{'message':'File approved for customer download.' if decision=='approve' else 'Submission rejected; writer can upload a revised version.'})

    def handle(self,method):
        path=urlsplit(self.h.path).path
        parts=path.strip('/').split('/')
        if path=='/api/writing/orders' and method=='GET':return self._orders_public()
        if len(parts)==5 and parts[:3]==['api','writing','orders'] and parts[4]=='instructions' and method=='GET':return self._order_detail(parts[3])
        if path=='/api/writing/my' and method=='GET':return self._my()
        if path=='/api/admin/writing/orders' and method=='GET':return self._admin_orders()
        if path=='/api/admin/writing/writers' and method=='GET':return self._admin_writers()
        if len(parts)==6 and parts[:4]==['api','admin','writing','orders'] and parts[5]=='messages' and method=='GET':
            return self._messages(parts[4],admin=True)
        if len(parts)==5 and parts[:3]==['api','writing','orders']:
            oid=parts[3]
            if parts[4]=='bids' and method=='GET':return self._bids(oid)
            if parts[4]=='bids' and method=='POST':return self._bid(oid)
            if parts[4]=='choose' and method=='POST':return self._choose(oid)
            if parts[4]=='deliver' and method=='POST':return self._upload(oid)
            if parts[4]=='cancel' and method=='POST':return self._cancel_order(oid)
            if parts[4]=='messages' and method=='GET':return self._messages(oid)
            if parts[4]=='messages' and method=='POST':return self._messages(oid,posting=True)
        if path=='/api/writing/orders' and method=='POST':return self._create_order()
        if len(parts)==4 and parts[:3]==['api','writing','attachments'] and method=='GET':return self._instruction_file_download(parts[3])
        if len(parts)==5 and parts[:4]==['api','admin','writing','attachments'] and method=='GET':return self._instruction_file_download(parts[4],True)
        if len(parts)==4 and parts[:3]==['api','writing','files'] and method=='GET':return self._file_download(parts[3])
        if len(parts)==5 and parts[:4]==['api','admin','writing','files'] and method=='GET':return self._file_download(parts[4],True)
        if len(parts)==6 and parts[:4]==['api','admin','writing','orders']:
            if parts[5]=='bids' and method=='GET':return self._admin_bids(parts[4])
            if parts[5]=='choose' and method=='POST':return self._admin_choose(parts[4])
            if parts[5]=='assign-direct' and method=='POST':return self._admin_direct_assign(parts[4])
        if len(parts)==5 and parts[:4]==['api','admin','writing','orders'] and method=='POST':return self._review(parts[4])
        return self.error(404,'Writing endpoint not found.')
