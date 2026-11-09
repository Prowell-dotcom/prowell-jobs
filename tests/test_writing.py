"""Prowell Writing marketplace role checks, bidding, private file delivery and admin review."""
import base64
import json
import os
import threading
import tempfile
from pathlib import Path
import unittest
import uuid
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from unittest.mock import patch
from test_smoke import server

class WritingMarketplaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_db = server.DATABASE_PATH
        cls.old_upload_root = server.WRITING_UPLOAD_ROOT
        server.DATABASE_PATH = Path(cls.tmp.name) / 'writing-test.sqlite3'
        server.WRITING_UPLOAD_ROOT = Path(cls.tmp.name) / 'writing-private-files'
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.worker=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.worker.start()
        # Authenticate through the real one-time owner setup instead of using
        # the retired bearer-key shortcut after an owner account is created.
        setup={
            'setupKey':server.ADMIN_KEY,
            'email':'test-owner@example.test',
            'fullName':'Test Marketplace Owner',
            'password':'Local test-only owner passphrase 123!',
            'confirmPassword':'Local test-only owner passphrase 123!'
        }
        request=Request(
            f'http://127.0.0.1:{cls.port}/api/admin/bootstrap',
            data=json.dumps(setup).encode(),
            headers={'Content-Type':'application/json'},
            method='POST'
        )
        with urlopen(request,timeout=10) as response:
            assert response.status==200, 'Writing tests require a real admin session'
            payload=json.loads(response.read())
            cls.admin_cookie=response.headers['Set-Cookie'].split(';')[0]
            cls.admin_csrf=payload['csrfToken']

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.worker.join(timeout=3);cls.httpd.server_close()
        server.DATABASE_PATH = cls.old_db
        server.WRITING_UPLOAD_ROOT = cls.old_upload_root
        cls.tmp.cleanup()

    def setUp(self):
        with server.rate_lock:server.submission_times.clear()
        server.MEMBER_EMAIL_VERIFICATION_REQUIRED=True
        self.mock=patch.object(server,'deliver_notification_event',return_value='sent')
        self.mock.start()

    def tearDown(self):self.mock.stop()

    def call(self,method,path,payload=None,cookie='',csrf='',admin=False):
        headers={'Accept':'application/json'}
        if payload is not None:headers['Content-Type']='application/json'
        if cookie:headers['Cookie']=cookie
        if csrf:headers['X-Member-CSRF']=csrf
        if admin:
            headers['Cookie']=self.admin_cookie
            if method in ('POST','PATCH','PUT','DELETE'):
                headers['X-Admin-CSRF']=self.admin_csrf
        req=Request(f'http://127.0.0.1:{self.port}{path}',
                    data=json.dumps(payload).encode() if payload is not None else None,
                    headers=headers,method=method)
        try:
            with urlopen(req,timeout=10) as response:
                content=response.read()
                return response.status,(json.loads(content) if response.headers.get('Content-Type','').startswith('application/json') else content),response.headers
        except HTTPError as e:
            content=e.read();return e.code,(json.loads(content) if e.headers.get('Content-Type','').startswith('application/json') else content),e.headers

    def signup(self,role):
        with patch.object(server,'email_configured',return_value=False):
            code,info,headers=self.call('POST','/api/member/signup',{'role':role,'fullName':'Test Account',
                'email':f'{uuid.uuid4().hex}@example.test','password':'Example passphrase 12 chars!',
                'consent':True})
        self.assertEqual(code,200,info)
        with server.db_connection() as db:
            db.execute('UPDATE members SET emailVerified=1 WHERE id=?',(info['member']['id'],))
        return info['member']['id'],headers.get('Set-Cookie').split(';')[0],info['csrfToken']

    def test_order_bid_choice_privacy_approval_and_download(self):
        client_id,cc,ct=self.signup('client');writer_id,wc,wt=self.signup('writer')
        o={'title':'Proofread a professional report','category':'Proofreading & Editing',
           'brief':'Improve clarity and grammar in a business report without changing ideas.',
           'deadline':'2030-01-14','budgetKES':850,'integrityConsent':True}
        self.assertEqual(self.call('POST','/api/writing/orders',o)[0],401)
        self.assertEqual(self.call('POST','/api/writing/orders',o,cc,ct)[0],201)
        code,my,_=self.call('GET','/api/writing/my',cookie=cc)
        self.assertEqual(code,200)
        oid=my['orders'][-1]['id']
        code,public,_=self.call('GET','/api/writing/orders')
        self.assertEqual(code,200)
        self.assertNotIn('clientId',json.dumps(public));self.assertNotIn('example.test',json.dumps(public))
        b={'amountKES':800,'days':2,'proposal':'I can edit this business report for clarity and grammar.'}
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/bids',b,cc,ct)[0],401)
        code,result,_=self.call('POST',f'/api/writing/orders/{oid}/bids',b,wc,wt)
        self.assertEqual(code,201,result)
        bid_id=result['id']
        self.assertEqual(self.call('GET',f'/api/writing/orders/{oid}/bids',cookie=wc)[0],403)
        self.assertEqual(self.call('GET',f'/api/writing/orders/{oid}/bids',cookie=cc)[0],200)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/choose',{'bidId':bid_id},wc,wt)[0],401)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/choose',{'bidId':bid_id},cc,ct)[0],200)
        content=base64.b64encode(b'Corrected example professional writing text.').decode()
        file={'filename':'review.txt','contentBase64':content}
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/deliver',file,cc,ct)[0],401)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/deliver',file,wc,wt)[0],201)
        code,my,_=self.call('GET','/api/writing/my',cookie=cc)
        fid=my['deliverables'][-1]['id']
        self.assertEqual(self.call('GET',f'/api/writing/files/{fid}',cookie=cc)[0],403)
        self.assertEqual(self.call('GET',f'/api/writing/files/{fid}',cookie=wc)[0],403)
        self.assertEqual(self.call('GET','/api/admin/writing/orders')[0],401)
        code,adm,_=self.call('GET','/api/admin/writing/orders',admin=True)
        self.assertEqual(code,200)
        self.assertTrue(any(x['id']==fid for x in adm['files']))
        self.assertEqual(self.call('GET',f'/api/admin/writing/files/{fid}',admin=True)[0],200)
        code,res,_=self.call('POST',f'/api/admin/writing/orders/{oid}',{'fileId':fid,'decision':'approve'},admin=True)
        self.assertEqual(code,200,res)
        code,data,headers=self.call('GET',f'/api/writing/files/{fid}',cookie=cc)
        self.assertEqual(code,200)
        self.assertEqual(data,b'Corrected example professional writing text.')
        self.assertIn('attachment',headers['Content-Disposition'])
        self.assertEqual(self.call('POST',f'/api/admin/writing/orders/{oid}',{'fileId':fid,'decision':'approve'},admin=True)[0],409)

    def test_reject_returns_to_writer_and_role_restrictions(self):
        _,c,cs=self.signup('client');_,w,ws=self.signup('writer')
        order={'title':'Edit a business cover letter','category':'Business Writing','brief':'Improve the tone and clarity of my business letter draft.',
              'deadline':'2030-07-20','budgetKES':1000,'integrityConsent':True}
        code,result,_=self.call('POST','/api/writing/orders',order,c,cs);self.assertEqual(code,201,result)
        oid=result['id'];bid={'amountKES':700,'days':2,'proposal':'I have experience writing concise professional letters.'}
        code,result,_=self.call('POST',f'/api/writing/orders/{oid}/bids',bid,w,ws);self.assertEqual(code,201,result)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/choose',{'bidId':result['id']},c,cs)[0],200)
        encoded=base64.b64encode(b'This is an original business letter.').decode()
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/deliver',{'filename':'letter.txt','contentBase64':encoded},w,ws)[0],201)
        code,my,_=self.call('GET','/api/writing/my',cookie=w);fid=my['deliverables'][-1]['id']
        self.assertEqual(self.call('POST',f'/api/admin/writing/orders/{oid}',{'fileId':fid,'decision':'reject'},admin=True)[0],200)
        self.assertEqual(self.call('GET',f'/api/writing/files/{fid}',cookie=c)[0],403)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{oid}/deliver',{'filename':'letter.txt','contentBase64':encoded},w,ws)[0],201)

    def test_invalid_document_and_integrity_consent(self):
        _,c,cs=self.signup('client')
        bad={'title':'Ghostwrite graded exam','category':'Academic Tutoring','brief':'A tutor to take my graded examination on my behalf.',
             'deadline':'2030-01-01','budgetKES':500,'integrityConsent':False}
        self.assertEqual(self.call('POST','/api/writing/orders',bad,c,cs)[0],400)
        from writing_marketplace import validate_file
        for name,blob in [('x.pdf',b'not pdf'),('x.exe',b'evil'),('x.docx',b'not a zip')]:
            with self.assertRaises(ValueError):validate_file(name,base64.b64encode(blob).decode())

if __name__=='__main__':unittest.main()
