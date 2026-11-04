"""Automatic applicant and employer acknowledgements; never call a real provider."""
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
from test_smoke import server


class AutoReplyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.initialize_db()
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.worker = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.worker.join(timeout=5)
        cls.httpd.server_close()

    def setUp(self):
        with server.rate_lock:
            server.submission_times.clear()

    def call(self, method, path, payload=None, admin=False):
        headers = {'Content-Type':'application/json'}
        if admin:
            headers['Authorization'] = 'Bearer ' + server.ADMIN_KEY
        req = Request('http://127.0.0.1:%s%s' % (self.port,path),
                      method=method,headers=headers,
                      data=json.dumps(payload).encode() if payload is not None else None)
        try:
            with urlopen(req, timeout=8) as result:
                return result.status, json.loads(result.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def notices(self, record_id):
        with server.db_connection() as db:
            return [dict(r) for r in db.execute('SELECT * FROM notification_outbox WHERE jobId=?',(record_id,))]

    def test_applicant_confirmation_and_admin_alert_without_data_leak(self):
        job = dict(title='Test Housekeeping Job',company='Example Recruiter',category='Domestic & Home Help',
                   location='Nairobi',workMode='On-site',jobType='Part-time',experience='Entry level',
                   description='This is a dummy job that exists to test website notifications only.',
                   email='hiring@example.test')
        with patch.object(server,'send_notification'):
            status, posted = self.call('POST','/api/jobs',job)
            self.assertEqual(status,201,posted)
            status,_ = self.call('PATCH','/api/admin/jobs/'+posted['id'],{'status':'approved'},admin=True)
            self.assertEqual(status,200)
        application=dict(jobId=posted['id'],fullName='Private Applicant',email='private-applicant@example.test',
                         phone='',country='Kenya',city='Nairobi',experience='Entry level',
                         message='I have the necessary skills to complete housekeeping tasks carefully.',consent=True)
        status, response = self.call('POST','/api/applications',application)
        self.assertEqual(status,201,response)
        self.assertTrue(response['confirmationEmailQueued'])
        entries=self.notices(response['id'])
        self.assertEqual(len(entries),2)
        self.assertCountEqual([x['recipient'] for x in entries],
                              ['prowellofficial@gmail.com','private-applicant@example.test'])
        self.assertNotIn('Private Applicant', ' '.join(x['body'] for x in entries))
        self.assertNotIn(response['withdrawalCode'], ' '.join(x['body'] for x in entries))
        for entry in entries:
            with patch.object(server,'send_notification') as send:
                self.assertEqual(server.deliver_notification_event(entry['eventId']),'sent')
                send.assert_called_once()
        status,_=self.call('PATCH','/api/admin/applications/'+response['id'],{'status':'reviewed'},admin=True)
        self.assertEqual(status,200)
        notices=self.notices(response['id'])
        self.assertEqual(len(notices),3)
        status,_=self.call('PATCH','/api/admin/applications/'+response['id'],{'status':'reviewed'},admin=True)
        self.assertEqual(status,200)
        self.assertEqual(len(self.notices(response['id'])),3)

    def test_candidate_receipt_and_update(self):
        data=dict(alias='Candidate Example',category='Domestic & Home Help',country='Kenya',city='Nairobi',
                  skills='Cooking and cleaning',experience='Entry level',availability='Weekdays',
                  summary='I have experience assisting households with reliable daily cleaning services.',
                  email='private-candidate@example.test',consent=True)
        status, res=self.call('POST','/api/candidates',data)
        self.assertEqual(status,201,res)
        self.assertTrue(res['confirmationEmailQueued'])
        self.assertEqual(len(self.notices(res['id'])),2)
        status,_=self.call('PATCH','/api/admin/candidates/'+res['id'],{'status':'approved'},admin=True)
        self.assertEqual(status,200)
        self.assertEqual(len(self.notices(res['id'])),3)

    def test_review_opt_in_is_not_published(self):
        data=dict(name='Example Reviewer',relationship='Job seeker',kind='comment',rating=None,
                  comment='My experience was positive but this is only a nonpublic test.',
                  notifyEmail='private-reviewer@example.test',notifyConsent=True)
        status,res=self.call('POST','/api/reviews',data)
        self.assertEqual(status,201,res)
        self.assertTrue(res['confirmationEmailQueued'])
        status,_=self.call('PATCH','/api/admin/reviews/'+res['id'],{'status':'approved'},admin=True)
        self.assertEqual(status,200)
        status,public=self.call('GET','/api/reviews')
        self.assertEqual(status,200)
        self.assertNotIn('private-reviewer@example.test',json.dumps(public))
        self.assertEqual(len(self.notices(res['id'])),3)

    def test_feedback_without_email_gets_only_admin_alert(self):
        data=dict(name='No Email Example',relationship='Job seeker',kind='comment',rating=None,
                  comment='An example to confirm optional emails are not exposed or contacted.')
        status,res=self.call('POST','/api/reviews',data)
        self.assertEqual(status,201,res)
        self.assertFalse(res['confirmationEmailQueued'])
        self.assertEqual([x['recipient'] for x in self.notices(res['id'])],['prowellofficial@gmail.com'])

    def test_report_and_alert_interest_receipts(self):
        for endpoint,payload in [
            ('reports',dict(subject='Suspicious example',details='This message is fictional and exists only for testing.',email='reporter@example.test')),
            ('alerts',dict(email='subscriber@example.test',category='Technology',country='Kenya',consent=True))]:
            status,res=self.call('POST','/api/'+endpoint,payload)
            self.assertEqual(status,201,res)
            self.assertEqual(len(self.notices(res['id'])),2)
            self.assertTrue(res['confirmationEmailQueued'])
            if endpoint=='alerts':
                body=self.notices(res['id'])[1]['body']
                self.assertIn('not active yet',body)

if __name__=='__main__':unittest.main()
