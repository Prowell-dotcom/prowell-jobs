"""Expanded job sectors, candidate privacy, reviews and reports: integration tests."""
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

# Reuse the same isolated server module configured by the smoke test.
from test_smoke import server


class FeatureTests(unittest.TestCase):
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
        cls.worker.join(timeout=3)
        cls.httpd.server_close()

    def req(self, method, path, obj=None, admin=False):
        headers={'Content-Type':'application/json'}
        if admin:
            headers['Authorization']='Bearer '+server.ADMIN_KEY
        data=json.dumps(obj).encode() if obj is not None else None
        req=Request(f'http://127.0.0.1:{self.port}{path}',data=data,headers=headers,method=method)
        try:
            with urlopen(req, timeout=4) as r:
                text=r.read()
                return r.status,json.loads(text) if path.startswith('/api/') else text
        except HTTPError as ex:
            return ex.code,json.loads(ex.read())

    def test_casual_boda_boda_and_pay_per_trip(self):
        job={'title':'Boda boda delivery rider test','company':'Example test client','category':'Transport & Ride-hailing',
             'country':'Kenya','location':'Thika, Kenya','workMode':'Mobile / field work','jobType':'Gig / per task',
             'experience':'No experience needed','currency':'KES','payPeriod':'trip','salaryMin':200,'salaryMax':600,
             'description':'Illustrative testing job only, not an actual opportunity for any rider.',
             'email':'testing@example.com','applyUrl':'','phone':'','requirements':'Safe driving and valid licensing',
             'responsibilities':'Transport items safely and promptly','benefits':'Payment per trip','deadline':''}
        status,response=self.req('POST','/api/jobs',job)
        self.assertEqual(status,201,response)
        jid=response['id']
        status,public=self.req('GET','/api/jobs')
        self.assertNotIn(jid,[x['id'] for x in public['jobs']])
        status,_=self.req('PATCH','/api/admin/jobs/'+jid,{'status':'approved','verified':False},admin=True)
        self.assertEqual(status,200)
        status,public=self.req('GET','/api/jobs')
        match=next(x for x in public['jobs'] if x['id']==jid)
        self.assertEqual(match['payPeriod'],'trip')
        self.assertFalse(match['verified'])

    def test_candidate_contact_never_public_and_can_withdraw(self):
        payload={'alias':'Mariam K.','category':'Domestic & Home Help','country':'Kenya','city':'Nairobi',
                 'skills':'Cleaning, cooking, household support','experience':'Entry level','availability':'Immediately',
                 'summary':'I have experience supporting families with home tasks and household cleaning.',
                 'currency':'KES','payExpectation':'1500 daily','email':'private.candidate@example.com',
                 'phone':'+254700000001','consent':True}
        status,r=self.req('POST','/api/candidates',payload)
        self.assertEqual(status,201,r)
        self.assertIn('withdrawalCode',r)
        cid=r['id']
        status,public=self.req('GET','/api/candidates')
        self.assertNotIn(cid,[x['id'] for x in public['candidates']])
        status,_=self.req('PATCH','/api/admin/candidates/'+cid,{'status':'approved'},admin=True)
        self.assertEqual(status,200)
        status,public=self.req('GET','/api/candidates')
        row=next(x for x in public['candidates'] if x['id']==cid)
        self.assertNotIn('email',row)
        self.assertNotIn('phone',row)
        self.assertNotIn('withdrawalHash',row)
        self.assertNotIn('private.candidate@example.com',json.dumps(public))
        status,denied=self.req('DELETE','/api/candidates/'+cid,{'withdrawalCode':'wrong'})
        self.assertEqual(status,403)
        status,removed=self.req('DELETE','/api/candidates/'+cid,{'withdrawalCode':r['withdrawalCode']})
        self.assertEqual(status,200,removed)
        status,public=self.req('GET','/api/candidates')
        self.assertNotIn(cid,[x['id'] for x in public['candidates']])

    def test_reviews_require_approval(self):
        status,r=self.req('POST','/api/reviews',{'name':'Test visitor','relationship':'Job seeker',
                       'kind':'comment','rating':None,'comment':'This is only a test comment, not a client testimonial.'})
        self.assertEqual(status,201,r)
        rid=r['id']
        status,public=self.req('GET','/api/reviews')
        self.assertNotIn(rid,[x['id'] for x in public['reviews']])
        status,_=self.req('PATCH','/api/admin/reviews/'+rid,{'status':'approved'},admin=True)
        self.assertEqual(status,200)
        status,public=self.req('GET','/api/reviews')
        self.assertIn(rid,[x['id'] for x in public['reviews']])

    def test_alert_interest_and_reports_are_private(self):
        status,alert=self.req('POST','/api/alerts',{'email':'alerts@example.com',
            'country':'Kenya','category':'Agriculture & Farming','consent':True})
        self.assertEqual(status,201,alert)
        self.assertIn('not enabled',alert['message'])
        status,report=self.req('POST','/api/reports',{'subject':'Suspicious test listing',
            'details':'An illustrative, completely fictional phishing report for automated testing.',
            'email':'reporter@example.com'})
        self.assertEqual(status,201,report)
        status,_=self.req('GET','/api/admin/reports')
        self.assertEqual(status,401)
        status,private=self.req('GET','/api/admin/reports',admin=True)
        self.assertIn(report['id'],[x['id'] for x in private['reports']])


if __name__=='__main__':
    unittest.main()
