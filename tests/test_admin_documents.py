"""Administrator-only direct document email: authentication, attachment and audit tests."""
import base64
import json
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_smoke import server
import admin_document_sender as docs

class AdminDocumentEmailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.prev=server.DATABASE_PATH
        cls.prev_uploads=server.WRITING_UPLOAD_ROOT
        server.DATABASE_PATH=Path(cls.tmp.name)/'doc-mail.sqlite3'
        server.WRITING_UPLOAD_ROOT=Path(cls.tmp.name)/'uploads'
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.thread.join(timeout=4);cls.httpd.server_close()
        server.DATABASE_PATH=cls.prev
        server.WRITING_UPLOAD_ROOT=cls.prev_uploads
        cls.tmp.cleanup()

    def call(self,method,path,payload=None,cookie='',csrf=''):
        headers={'Accept':'application/json'}
        if payload is not None:headers['Content-Type']='application/json'
        if cookie:headers['Cookie']=cookie
        if csrf:headers['X-Admin-CSRF']=csrf
        data=json.dumps(payload).encode() if payload is not None else None
        req=Request(f'http://127.0.0.1:{self.port}{path}',headers=headers,data=data,method=method)
        try:res=urlopen(req,timeout=10)
        except HTTPError as exc:res=exc
        with res:
            b=res.read()
            try:body=json.loads(b)
            except ValueError:body={}
            return res.status,body,res.headers

    def test_document_sender_requires_admin_login_and_csrf(self):
        data=self.sample()
        self.assertEqual(self.call('GET','/api/admin/documents/history')[0],401)
        self.assertEqual(self.call('POST','/api/admin/documents/send',data)[0],401)
        request={'setupKey':server.ADMIN_KEY, 'email':'owner@test.example','fullName':'Owner',
                 'password':'Owner super-strong password!','confirmPassword':'Owner super-strong password!'}
        code,body,h=self.call('POST','/api/admin/bootstrap',request)
        self.assertEqual(code,200,body)
        self.__class__.cookie=h['Set-Cookie'].split(';')[0]
        self.__class__.csrf=body['csrfToken']
        self.assertEqual(self.call('POST','/api/admin/documents/send',data,cookie=self.cookie)[0],403)
        with patch.object(docs,'send_via_resend',return_value='eml-test-123') as fake:
            code,answer,_=self.call('POST','/api/admin/documents/send',data,cookie=self.cookie,csrf=self.csrf)
        self.assertEqual(code,200,answer)
        self.assertEqual(answer['emailId'],'eml-test-123')
        fake.assert_called_once()
        code,history,_=self.call('GET','/api/admin/documents/history',cookie=self.cookie)
        self.assertEqual(code,200)
        self.assertEqual(len(history['records']),1)
        self.assertEqual(history['records'][0]['recipient'],'client@example.org')
        self.assertNotIn('fileBase64',json.dumps(history))

    def test_reject_malicious_or_large_files_and_duplicate_sends(self):
        data=self.sample()
        data['filename']='evil.exe'
        self.assertEqual(self.call('POST','/api/admin/documents/send',data,cookie=self.cookie,csrf=self.csrf)[0],400)
        data=self.sample()
        data['recipient']='not-email'
        self.assertEqual(self.call('POST','/api/admin/documents/send',data,cookie=self.cookie,csrf=self.csrf)[0],400)
        data=self.sample()
        data['fileBase64']=base64.b64encode(b'x'*(docs.MAX_DOCUMENT_BYTES+1)).decode()
        self.assertEqual(self.call('POST','/api/admin/documents/send',data,cookie=self.cookie,csrf=self.csrf)[0],400)
        data=self.sample()
        with patch.object(docs,'send_via_resend',return_value='eml-test-456') as fake:
            self.assertEqual(self.call('POST','/api/admin/documents/send',data,cookie=self.cookie,csrf=self.csrf)[0],200)
            self.assertEqual(self.call('POST','/api/admin/documents/send',data,cookie=self.cookie,csrf=self.csrf)[0],200)
            fake.assert_called_once()

    def test_resend_attachment_request_uses_working_headers(self):
        captured={}
        class FakeReply:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,_n):return b'{"id":"message123"}'
        def intercept(request,timeout):
            captured['request']=request
            return FakeReply()
        data=docs.validate_document(self.sample())
        with patch.dict('os.environ',{'RESEND_API_KEY':'test-secret','NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com'}),patch.object(docs,'urlopen',side_effect=intercept):
            self.assertEqual(docs.send_via_resend(data),'message123')
        req=captured['request']
        payload=json.loads(req.data)
        self.assertEqual(payload['to'],['client@example.org'])
        self.assertEqual(payload['attachments'][0]['filename'],'report.pdf')
        self.assertEqual(base64.b64decode(payload['attachments'][0]['content']),b'%PDF-1.4\nHello')
        self.assertEqual(req.get_header('User-agent'),'ProwellJobs/1.0')
        self.assertEqual(req.get_header('Accept'),'application/json')

    @staticmethod
    def sample():
        return {'recipient':'client@example.org','subject':'Project document',
                'message':'Please see attached.', 'filename':'report.pdf',
                'fileBase64':base64.b64encode(b'%PDF-1.4\nHello').decode(),
                'requestId':str(uuid.uuid4()),'confirmed':True}

if __name__=='__main__':unittest.main()
