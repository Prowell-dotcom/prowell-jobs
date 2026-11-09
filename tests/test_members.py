"""Free account sign-up/sign-in/session and account isolation regression tests."""
import json, re, threading, unittest, uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from test_smoke import server

class FreeMemberTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.worker=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.worker.join(timeout=3);cls.httpd.server_close()

    def setUp(self):
        server.MEMBER_LOGIN_REQUIRED=True
        server.MEMBER_EMAIL_VERIFICATION_REQUIRED=True
        with server.rate_lock: server.submission_times.clear()

    def tearDown(self):
        server.MEMBER_LOGIN_REQUIRED=False

    def call(self,method,path,payload=None,cookie=None,csrf=None):
        headers={'Content-Type':'application/json'}
        if cookie:headers['Cookie']=cookie
        if csrf:headers['X-Member-CSRF']=csrf
        req=Request(f'http://127.0.0.1:{self.port}{path}',
                    data=json.dumps(payload).encode() if payload is not None else None,
                    headers=headers,method=method)
        try:
            with urlopen(req,timeout=8) as response:
                data=response.read()
                return response.status,json.loads(data) if path.startswith('/api/') and path!='/api/member/verify' else data,response.headers
        except HTTPError as error:
            return error.code,json.loads(error.read()),error.headers

    def register(self,role='employer'):
        email='user.'+uuid.uuid4().hex[:12]+'@example.test'
        with patch.object(server,'email_configured',return_value=False):
            status,obj,headers=self.call('POST','/api/member/signup',{
              'fullName':'Example Member','email':email,'role':role,'password':'A secure test password number 9!',
              'phone':'+254703772555','consent':True})
        self.assertEqual(status,200,obj)
        self.assertEqual(obj['membership']['priceKES'],0)
        return email,obj,headers.get('Set-Cookie','').split(';')[0]

    def test_signup_role_login_logout_and_free_status(self):
        email,account,cookie=self.register('jobseeker')
        self.assertEqual(account['member']['role'],'jobseeker')
        self.assertFalse(account['member']['emailVerified'])
        self.assertFalse(account['membership']['paymentRequired'])
        status,result,_=self.call('GET','/api/member/me',cookie=cookie)
        self.assertEqual(status,200);self.assertTrue(result['authenticated'])
        status,result,_=self.call('POST','/api/member/logout',{},cookie=cookie,csrf=account['csrfToken'])
        self.assertEqual(status,200)
        status,result,_=self.call('GET','/api/member/me',cookie=cookie)
        self.assertFalse(result['authenticated'])
        status,result,_=self.call('POST','/api/member/login',{'email':email,'password':'A secure test password number 9!'})
        self.assertEqual(status,200,result)

    def test_job_submission_requires_employer_and_csrf_and_verification(self):
        email,member,cookie=self.register('jobseeker')
        job={'title':'TEST Receptionist','company':'Illustrative employer','category':'Hospitality & Food','location':'Kenya',
             'workMode':'On-site','jobType':'Casual / day work','experience':'Entry level','description':'This is a demo posting to test account access.', 'email':'jobs@example.test'}
        status,_,_=self.call('POST','/api/jobs',job)
        self.assertEqual(status,401)
        status,_,_=self.call('POST','/api/jobs',job,cookie=cookie,csrf=member['csrfToken'])
        self.assertEqual(status,401) # job seeker cannot post
        email,member,cookie=self.register('employer')
        status,_,_=self.call('POST','/api/jobs',job,cookie=cookie)
        self.assertEqual(status,401)
        status,_,_=self.call('POST','/api/jobs',job,cookie=cookie,csrf=member['csrfToken'])
        self.assertEqual(status,403) # email not verified
        with server.db_connection() as db:
            db.execute('UPDATE members SET emailVerified=1 WHERE id=?',(member['member']['id'],))
        status,res,_=self.call('POST','/api/jobs',job,cookie=cookie,csrf=member['csrfToken'])
        self.assertEqual(status,201,res)
        status,own,_=self.call('GET','/api/member/dashboard',cookie=cookie)
        self.assertEqual(status,200)
        self.assertTrue(any(j['id']==res['id'] for j in own['jobs']))
        self.assertEqual(next(j for j in own['jobs'] if j['id']==res['id'])['status'],'pending')
        email2,member2,cookie2=self.register('employer')
        status,others,_=self.call('GET','/api/member/dashboard',cookie=cookie2)
        self.assertFalse(any(j['id']==res['id'] for j in others['jobs']))

    def test_payments_disabled_and_reset_link_without_account_enumeration(self):
        status,res,_=self.call('POST','/api/member/payment/start',{'phone':'254703772555'})
        self.assertEqual(status,404)
        status,res,_=self.call('POST','/api/member/forgot',{'email':'missing@example.test'})
        self.assertEqual(status,200)

    def test_duplicate_email_is_rejected(self):
        email,member,cookie=self.register()
        status,res,_=self.call('POST','/api/member/signup',{'fullName':'Someone Else','email':email,'role':'jobseeker','password':'Another secret password 123!','consent':True})
        self.assertEqual(status,409)

if __name__=='__main__':unittest.main()
