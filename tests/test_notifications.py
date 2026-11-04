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
            with patch.object(server,'send_notification') as immediate_send:
                status,res=self.api('POST','/api/jobs',job)
                self.assertEqual(status,201,res)
                self.assertEqual(immediate_send.call_count,1)
                self.assertEqual(immediate_send.call_args.args[0],'email')
                self.assertEqual(immediate_send.call_args.args[1],'prowellofficial@gmail.com')
            jid=res['id']
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            self.assertEqual(status,200)
            sent=[r for r in admin['notification_outbox'] if r['jobId']==jid]
            self.assertEqual(len(sent),3)
            self.assertEqual({x['channel'] for x in sent},{'email','sms'})
            self.assertEqual([x['status'] for x in sent if x['kind']=='submitted'].count('sent'),1)
            self.assertEqual([x['status'] for x in sent if x['kind']=='submitted'].count('pending'),2)
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
                self.assertGreaterEqual(send.call_count,4)
            status,admin=self.api('GET','/api/admin/notification_outbox',admin=True)
            self.assertTrue(all(r['status']=='sent' for r in admin['notification_outbox'] if r['jobId']==jid))

    def test_without_opt_in_does_not_notify_employer(self):
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-nonlive','NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com'}):
            job=self.example();job['notifyConsent']=False
            with patch.object(server,'send_notification'):
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
            self.assertEqual(rows[0]['status'],'sent')


    def test_vacancy_alert_remains_queued_when_resend_missing_and_retries(self):
        with patch.dict(os.environ, {'RESEND_API_KEY':'', 'NOTIFY_FROM_EMAIL':'',
                                     'ADMIN_NOTIFICATION_EMAIL':'prowellofficial@gmail.com'}):
            job=self.example();job['notifyConsent']=False
            status,response=self.api('POST','/api/jobs',job)
            self.assertEqual(status,201,response)
            with server.db_connection() as db:
                row=db.execute("SELECT * FROM notification_outbox WHERE jobId=? AND channel='email'",
                               (response['id'],)).fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(row['status'],'retry')
                self.assertEqual(row['attempts'],1)
                self.assertIn('Email provider not configured',row['lastError'])
                db.execute('UPDATE notification_outbox SET nextAttemptAt=0 WHERE eventId=?',(row['eventId'],))
        with patch.object(server,'send_notification') as retry_send:
            self.assertEqual(server.process_notification_outbox(max_batch=100)>=1,True)
            retry_send.assert_called()
        with server.db_connection() as db:
            updated=db.execute('SELECT status,attempts FROM notification_outbox WHERE eventId=?',
                               (row['eventId'],)).fetchone()
            self.assertEqual(updated['status'],'sent')
            self.assertEqual(updated['attempts'],2)

    def test_resend_errors_show_safe_status_without_secret(self):
        from io import BytesIO
        from notifications import NotificationDeliveryError
        error_body=b'{"name":"validation_error","message":"Sensitive data must not be shown"}'
        response=HTTPError('https://api.resend.com/emails',403,'Forbidden',{},BytesIO(error_body))
        with patch.dict(os.environ,{'RESEND_API_KEY':'offline-secret-key',
                                    'NOTIFY_FROM_EMAIL':'notifications@prowelljobs.com'}):
            with patch.object(notifications,'urlopen',side_effect=response):
                with self.assertRaises(NotificationDeliveryError) as caught:
                    notifications.send_notification('email','prowellofficial@gmail.com',
                                                    'New job','Approve it','unique')
        self.assertEqual(str(caught.exception),'EMAIL HTTP 403 validation_error')
        self.assertNotIn('offline-secret-key',str(caught.exception))
        self.assertNotIn('Sensitive data',str(caught.exception))

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
                self.assertEqual(request.get_header('User-agent'), 'ProwellJobs/1.0')
                self.assertEqual(request.get_header('Accept'), 'application/json')
                self.assertEqual(request.get_header('Idempotency-key'), 'event-1')

if __name__=='__main__': unittest.main()
