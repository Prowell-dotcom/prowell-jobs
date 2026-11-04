"""Notification lifecycle, privacy and provider adapters (no real messages)."""
import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from test_smoke import server
import notifications


class NotificationsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.t=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.t.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.t.join(timeout=4);cls.httpd.server_close()

    def api(self,method,path,obj=None,admin=False):
        headers={'Content-Type':'application/json'}
        if admin: headers['Authorization']='Bearer '+server.ADMIN_KEY
        req=Request(f'http://127.0.0.1:{self.port}{path}',data=json.dumps(obj).encode() if obj is not None else None,
                    headers=headers,method=method)
        try:
            with urlopen(req,timeout=5) as r:return r.status,json.loads(r.read())
        except HTTPError as ex:return ex.code,json.loads(ex.read())

    @staticmethod
    def example():
        return {'title':'Testing job post','company':'Testing Company','category':'Technology',
                'location':'Nairobi','workMode':'Remote','jobType':'Full-time','experience':'Entry level',
                'currency':'KES','description':'This clearly labeled job exists only for integration tests.',
                'email':'jobs@example.test','applyUrl':'','phone':'','salaryMin':1000,'salaryMax':2000,
                'notifyEmail':'private.employer@example.test','notifyPhone':'+254703772555','notifyConsent':True}

    def test_opt_in_queues_notices_without_public_personal_details(self):
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-nonlive','NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com',
                                    'TWILIO_ACCOUNT_SID':'ACtest','TWILIO_AUTH_TOKEN':'test',
                                    'TWILIO_FROM_NUMBER':'+15551234567','ADMIN_NOTIFICATION_PHONE':''}):
            job=self.example()
            status,res=self.api('POST','/api/jobs',job)
            self.assertEqual(status,201,res)
            jid=res['id']
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            self.assertEqual(status,200)
            sent=[r for r in admin['notification_outbox'] if r['jobId']==jid]
            self.assertEqual(len(sent),3)
            self.assertEqual({x['channel'] for x in sent},{'email','sms'})
            self.assertTrue(all(x['status']=='pending' for x in sent))
            status,_=self.api('PATCH','/api/admin/jobs/'+jid,{'status':'approved'},admin=True)
            self.assertEqual(status,200)
            status,public=self.api('GET','/api/jobs')
            saved=next(r for r in public['jobs'] if r['id']==jid)
            self.assertNotIn('notifyEmail',saved)
            self.assertNotIn('notifyPhone',saved)
            self.assertNotIn('notifyConsent',saved)
            self.assertNotIn('private.employer@example.test',json.dumps(public))
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            sent=[r for r in admin['notification_outbox'] if r['jobId']==jid]
            self.assertEqual(len(sent),5)  # admin 1 + employer 2 at submission, employer 2 on approval
            status,_=self.api('PATCH','/api/admin/jobs/'+jid,{'status':'approved'},admin=True)
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            self.assertEqual(len([r for r in admin['notification_outbox'] if r['jobId']==jid]),5)
            # No network calls; mocked provider only
            with patch.object(server,'send_notification') as send:
                server.process_notification_outbox(100)
                self.assertGreaterEqual(send.call_count,5)
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            self.assertTrue(all(r['status']=='sent' for r in admin['notification_outbox'] if r['jobId']==jid))

    def test_without_opt_in_does_not_notify_employer(self):
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-nonlive','NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com'}):
            job=self.example();job['notifyConsent']=False
            status,res=self.api('POST','/api/jobs',job)
            self.assertEqual(status,201,res)
            status,admin=self.api('GET','/api/admin/jobs',admin=True)
            saved=next(r for r in admin['jobs'] if r['id']==res['id'])
            self.assertEqual(saved['notifyEmail'],'')
            self.assertEqual(saved['notifyPhone'],'')
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            rows=[r for r in admin['notification_outbox'] if r['jobId']==res['id']]
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['recipient'],'prowellofficial@gmail.com')

    def test_sms_validated(self):
        job=self.example();job['notifyPhone']='0703772555'
        status,res=self.api('POST','/api/jobs',job)
        self.assertEqual(status,400)
        self.assertIn('international format',res['error'])

    def test_email_adapter_provider_request_is_mocked(self):
        class FakeResponse:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-secret','NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com'}):
            with patch.object(notifications,'urlopen',return_value=FakeResponse()) as mocked:
                notifications.send_notification('email','test@example.org','Subject','Body','event-1')
                request=mocked.call_args.args[0]
                self.assertEqual(request.full_url,'https://api.resend.com/emails')
                self.assertEqual(json.loads(request.data)['to'],['test@example.org'])

if __name__=='__main__': unittest.main()
