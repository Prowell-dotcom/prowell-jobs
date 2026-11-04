"""Admin-only seven-day activity history, without deletion of underlying records."""
import base64
import json
import tempfile
import threading
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from test_smoke import server
import admin_document_sender as docs

class SevenDayActivityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.old_db=server.DATABASE_PATH
        cls.old_uploads=server.WRITING_UPLOAD_ROOT
        server.DATABASE_PATH=Path(cls.tmp.name)/'activity.sqlite3'
        server.WRITING_UPLOAD_ROOT=Path(cls.tmp.name)/'private'
        server.initialize_db()
        docs.initialize_table(server.db_connection)
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.worker=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.worker.start()
        status,body,headers=cls.call('POST','/api/admin/bootstrap',{
            'setupKey':server.ADMIN_KEY,'email':'test-owner@example.org',
            'fullName':'Test Administrator','password':'very long test password 1234',
            'confirmPassword':'very long test password 1234'})
        assert status==200,(status,body)
        cls.cookie=headers.get('Set-Cookie','').split(';')[0]
        cls.now=datetime.now(timezone.utc)
        recent=(cls.now-timedelta(hours=2)).isoformat()
        old=(cls.now-timedelta(days=8)).isoformat()
        with server.db_connection() as db:
            for title,when in [('Recent Open Position',recent),('Old Open Position',old)]:
                db.execute('''INSERT INTO jobs(id,title,company,category,location,workMode,jobType,experience,
                      currency,description,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                    (str(uuid.uuid4()),title,'Example','Technology','Kenya','Remote','Full-time','Entry level',
                     'KES','Test vacancy',when))
            for name,when in [('report-new.pdf',recent),('report-old.pdf',old)]:
                db.execute('''INSERT INTO admin_document_sends(id,recipient,subject,filename,fileBytes,
                     providerEmailId,sentAt) VALUES(?,?,?,?,?,?,?)''',
                    (str(uuid.uuid4()),'client@example.org','Document delivery',name,44,'resent-id',when))

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.worker.join(timeout=4);cls.httpd.server_close()
        server.DATABASE_PATH=cls.old_db
        server.WRITING_UPLOAD_ROOT=cls.old_uploads
        cls.tmp.cleanup()

    @classmethod
    def call(cls,method,path,payload=None,cookie=None):
        headers={'Accept':'application/json'}
        if cookie:headers['Cookie']=cookie
        if payload is not None:headers['Content-Type']='application/json'
        req=Request(f'http://127.0.0.1:{cls.port}{path}',headers=headers,
                data=json.dumps(payload).encode('utf-8') if payload is not None else None,method=method)
        try:reply=urlopen(req,timeout=5)
        except HTTPError as exc:reply=exc
        with reply:return reply.status,json.loads(reply.read()),reply.headers

    def test_private_activity_requires_admin_session(self):
        status,_,_=self.call('GET','/api/admin/activity')
        self.assertEqual(status,401)

    def test_last_seven_days_view_and_original_records_retained(self):
        status,result,_=self.call('GET','/api/admin/activity',cookie=self.cookie)
        self.assertEqual(status,200,result)
        self.assertEqual(result['days'],7)
        titles=[x['title'] for x in result['records']]
        self.assertIn('Recent Open Position',titles)
        self.assertIn('report-new.pdf',titles)
        self.assertNotIn('Old Open Position',titles)
        self.assertNotIn('report-old.pdf',titles)
        self.assertEqual(next(x for x in result['records'] if x['title']=='report-new.pdf')['recipient'], 'client@example.org')
        with server.db_connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM admin_document_sends').fetchone()[0],2)

    def test_document_sender_history_seven_days(self):
        status,result,_=self.call('GET','/api/admin/documents/history',cookie=self.cookie)
        self.assertEqual(status,200,result)
        self.assertEqual([r['filename'] for r in result['records']],['report-new.pdf'])

    def test_default_message_prefill_on_empty_submission(self):
        payload={'recipient':'client@example.org','subject':'Delivery', 'message':'',
             'attachments':[{'filename':'report.pdf','contentBase64':base64.b64encode(b'%PDF-1.4\nTest').decode()}],
             'requestId':str(uuid.uuid4()),'confirmed':True}
        self.assertEqual(docs.validate_document(payload)['message'],'It is a pleasure working with prowelljobs.com')

if __name__=='__main__':unittest.main()
