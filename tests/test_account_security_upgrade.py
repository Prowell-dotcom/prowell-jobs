"""Regression tests for owner recovery, verification resend, member settings, and employer privacy."""
import json
import re
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer
from test_smoke import server

class AccountSecurityUpgradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.previous_db=server.DATABASE_PATH
        cls.previous_root=server.WRITING_UPLOAD_ROOT
        server.DATABASE_PATH=Path(cls.temp.name)/'security.sqlite3'
        server.WRITING_UPLOAD_ROOT=Path(cls.temp.name)/'private-writing'
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.worker=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.worker.start()
    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.worker.join(timeout=4);cls.httpd.server_close()
        server.DATABASE_PATH=cls.previous_db
        server.WRITING_UPLOAD_ROOT=cls.previous_root
        cls.temp.cleanup()
    def setUp(self):
        self.old_required=server.MEMBER_LOGIN_REQUIRED
        self.old_verify=server.MEMBER_EMAIL_VERIFICATION_REQUIRED
        with server.rate_lock:server.submission_times.clear()
        server.MEMBER_LOGIN_REQUIRED=True
        server.MEMBER_EMAIL_VERIFICATION_REQUIRED=True
    def tearDown(self):
        server.MEMBER_LOGIN_REQUIRED=self.old_required
        server.MEMBER_EMAIL_VERIFICATION_REQUIRED=self.old_verify
    def call(self, method, path, payload=None, cookie='', csrf='', admin=False):
        headers={'Accept':'application/json'}
        if payload is not None: headers['Content-Type']='application/json'
        if cookie:headers['Cookie']=cookie
        if csrf:headers['X-Admin-CSRF' if admin else 'X-Member-CSRF']=csrf
        req=Request(f'http://127.0.0.1:{self.port}{path}',
                    data=json.dumps(payload).encode('utf-8') if payload is not None else None,
                    headers=headers,method=method)
        try:reply=urlopen(req,timeout=10)
        except HTTPError as e:reply=e
        with reply:
            data=reply.read()
            ct=reply.headers.get('Content-Type','')
            return reply.status,json.loads(data) if ct.startswith('application/json') else data,reply.headers
    def signup(self,role='jobseeker'):
        email='security.'+uuid.uuid4().hex[:13]+'@example.test'
        with patch.object(server,'email_configured',return_value=False):
            c,r,h=self.call('POST','/api/member/signup',{
                'fullName':'Security Tester','email':email,'role':role,
                'password':'Old member password Test-2026!','consent':True,'phone':'+254703772555'})
        self.assertEqual(c,200,r)
        return {'email':email,'id':r['member']['id'],'csrf':r['csrfToken'],
                'cookie':h['Set-Cookie'].split(';')[0], 'role':role}
    def test_member_password_change_revokes_all_sessions(self):
        user=self.signup()
        url='/api/member/password/change'
        p={'currentPassword':'wrong','newPassword':'New member password Test-2027!',
           'confirmPassword':'New member password Test-2027!'}
        self.assertEqual(self.call('POST',url,p,user['cookie'],user['csrf'])[0],401)
        p['currentPassword']='Old member password Test-2026!'
        self.assertEqual(self.call('POST',url,p,user['cookie'])[0],403)
        p['confirmPassword']='different-password'
        self.assertEqual(self.call('POST',url,p,user['cookie'],user['csrf'])[0],400)
        p['confirmPassword']=p['newPassword']
        code,body,_=self.call('POST',url,p,user['cookie'],user['csrf'])
        self.assertEqual(code,200,body)
        code,body,_=self.call('GET','/api/member/me',cookie=user['cookie'])
        self.assertFalse(body['authenticated'])
        self.assertEqual(self.call('POST','/api/member/login',{'email':user['email'],'password':p['currentPassword']})[0],401)
        self.assertEqual(self.call('POST','/api/member/login',{'email':user['email'],'password':p['newPassword']})[0],200)
    def test_update_profile_preserves_role_and_email_and_member_isolation(self):
        a=self.signup('writer');b=self.signup('writer')
        c,r,_=self.call('POST','/api/member/profile/update',{'fullName':'Updated Writer','phone':'+254 712 333 445'},a['cookie'],a['csrf'])
        self.assertEqual(c,200,r)
        c,r,_=self.call('GET','/api/member/me',cookie=a['cookie'])
        self.assertEqual(r['member']['fullName'],'Updated Writer')
        self.assertEqual(r['member']['email'],a['email'])
        self.assertEqual(r['member']['role'],'writer')
        c,r,_=self.call('GET','/api/member/me',cookie=b['cookie'])
        self.assertEqual(r['member']['fullName'],'Security Tester')
        self.assertEqual(self.call('POST','/api/member/profile/update',{'fullName':'E','phone':'INVALID','role':'admin'},a['cookie'],a['csrf'])[0],400)
    @patch.object(server,'deliver_notification_event',return_value='sent')
    def test_resend_verification_is_private_and_single_use(self,_send):
        user=self.signup()
        endpoint='/api/member/verification/resend'
        self.assertEqual(self.call('POST',endpoint,{},user['cookie'])[0],403)
        with patch.object(server,'email_configured',return_value=True):
            code,response,_=self.call('POST',endpoint,{},user['cookie'],user['csrf'])
        self.assertEqual(code,200,response)
        with server.db_connection() as db:
            row=db.execute("SELECT body FROM notification_outbox WHERE kind='member_verification_resend' AND jobId=? ORDER BY createdAt DESC LIMIT 1",(user['id'],)).fetchone()
        self.assertIsNotNone(row)
        token=re.search(r'token=([A-Za-z0-9_-]+)',row['body']).group(1)
        self.assertEqual(self.call('GET','/api/member/verify?token='+token)[0],200)
        c,r,_=self.call('GET','/api/member/me',cookie=user['cookie'])
        self.assertTrue(r['member']['emailVerified'])
        self.assertEqual(self.call('POST',endpoint,{},user['cookie'],user['csrf'])[1]['message'],'Your email is already verified.')
        self.assertEqual(self.call('GET','/api/member/verify?token='+token)[0],200) # redirect, now invalid
        with server.db_connection() as db:
            self.assertIsNone(db.execute('SELECT verificationHash FROM members WHERE id=?',(user['id'],)).fetchone()['verificationHash'])
    @patch.object(server,'deliver_notification_event',return_value='sent')
    def test_admin_recovery_only_existing_owner_and_single_use(self,_send):
        email='owner-'+uuid.uuid4().hex[:7]+'@example.test'
        data={'setupKey':server.ADMIN_KEY,'email':email,'fullName':'Prowell Owner',
              'password':'Original owner pass-2026!','confirmPassword':'Original owner pass-2026!'}
        code,r,h=self.call('POST','/api/admin/bootstrap',data)
        self.assertEqual(code,200,r)
        owner_cookie=h['Set-Cookie'].split(';')[0]
        self.assertTrue(self.call('GET','/api/admin/session',cookie=owner_cookie)[1]['authenticated'])
        with patch.object(server,'email_configured',return_value=True):
            c,wrong,_=self.call('POST','/api/admin/recovery/start',{'email':'missing@example.test'})
            c2,right,_=self.call('POST','/api/admin/recovery/start',{'email':email})
        self.assertEqual(c,200);self.assertEqual(c2,200)
        self.assertEqual(wrong['message'],right['message'])
        with server.db_connection() as db:
            row=db.execute("SELECT body FROM notification_outbox WHERE kind='admin_recovery' ORDER BY createdAt DESC LIMIT 1").fetchone()
        self.assertIsNotNone(row)
        token=re.search(r'adminReset=([A-Za-z0-9_-]+)',row['body']).group(1)
        url='/api/admin/recovery/complete'
        self.assertEqual(self.call('POST',url,{'token':token,'password':'Reset owner password-2027!','confirmPassword':'mismatch'})[0],400)
        c,r,_=self.call('POST',url,{'token':token,'password':'Reset owner password-2027!','confirmPassword':'Reset owner password-2027!'})
        self.assertEqual(c,200,r)
        self.assertFalse(self.call('GET','/api/admin/session',cookie=owner_cookie)[1]['authenticated'])
        self.assertEqual(self.call('POST',url,{'token':token,'password':'Different Password 123!!!','confirmPassword':'Different Password 123!!!'})[0],400)
        self.assertEqual(self.call('POST','/api/admin/login',{'email':email,'password':data['password']})[0],401)
        self.assertEqual(self.call('POST','/api/admin/login',{'email':email,'password':'Reset owner password-2027!'})[0],200)
        self.assertEqual(self.call('GET','/api/admin/bootstrap/status')[1]['registrationOpen'],False)
        self.assertEqual(self.call('POST','/api/admin/bootstrap',data)[0],409)
    def test_employer_applicant_inbox_separates_companies_and_moderation(self):
        a=self.signup('employer'); b=self.signup('employer');seeker=self.signup('jobseeker')
        with server.db_connection() as db:
            for u in (a,b,seeker):db.execute('UPDATE members SET emailVerified=1 WHERE id=?',(u['id'],))
            for u in (a,b):
                jid=str(uuid.uuid4());u['jobId']=jid
                db.execute('''INSERT INTO jobs(id,title,company,category,location,workMode,jobType,experience,currency,
                  description,createdAt,status,memberId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                  (jid,'Developer','Company '+u['email'],'Technology','Remote','Remote','Contract','Entry level',
                   'KES','An approved test job',server.timestamp(),'approved',u['id']))
            for owner,status in ((a,'reviewed'),(a,'pending'),(b,'reviewed')):
                db.execute('''INSERT INTO applications(id,jobId,jobTitle,employerName,fullName,email,
                    experience,message,consent,withdrawalHash,createdAt,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (str(uuid.uuid4()),owner['jobId'],'Developer','Company',
                     'Applicant for '+owner['email'],'private@applicant.test','Entry level','Test application detail',
                     1,'hash-placeholder',server.timestamp(),status))
        endpoint='/api/member/employer/applications'
        self.assertEqual(self.call('GET',endpoint)[0],401)
        self.assertEqual(self.call('GET',endpoint,cookie=seeker['cookie'])[0],403)
        c,r,_=self.call('GET',endpoint,cookie=a['cookie']);self.assertEqual(c,200,r)
        self.assertEqual(len(r['applications']),1)
        self.assertIn(a['email'],r['applications'][0]['fullName'])
        self.assertNotIn(b['email'],json.dumps(r))
        c,r,_=self.call('GET',endpoint,cookie=b['cookie']);self.assertEqual(c,200,r)
        self.assertEqual(len(r['applications']),1)
        self.assertIn(b['email'],r['applications'][0]['fullName'])
    def test_frontend_forms_exist(self):
        root=Path(__file__).resolve().parent.parent
        account=(root/'account.html').read_text()
        dashboard=(root/'dashboard.html').read_text()
        for key in ('adminRecoveryEmail','adminRecoveryReset','adminForgotLink','adminReset'):
            self.assertIn(key,account if key!='adminReset' else (root/'admin-account.js').read_text())
        for key in ('resendVerificationBtn','profileForm','changePasswordForm','employerInbox'):
            self.assertIn(key,dashboard)

if __name__=='__main__':unittest.main()
