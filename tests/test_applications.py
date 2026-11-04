"""Prowell Jobs: private end-to-end application intake tests."""
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from test_smoke import server


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        with server.rate_lock:
            server.submission_times.clear()

    @classmethod
    def setUpClass(cls):
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0), server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.thread.join(timeout=3);cls.httpd.server_close()

    def api(self,method,path,payload=None,admin=False):
        headers={'Content-Type':'application/json'}
        if admin: headers['Authorization']='Bearer '+server.ADMIN_KEY
        data=json.dumps(payload).encode() if payload is not None else None
        request=Request(f'http://127.0.0.1:{self.port}{path}',data=data,headers=headers,method=method)
        try:
            with urlopen(request,timeout=5) as r:
                return r.status,json.loads(r.read())
        except HTTPError as e:
            return e.code,json.loads(e.read())

    def test_private_application_workflow(self):
        job={'title':'Test housekeeper role','company':'Testing Employer','category':'Domestic & Home Help','location':'Nairobi',
             'country':'Kenya','workMode':'On-site','jobType':'Casual / day work','experience':'Entry level',
             'currency':'KES','description':'This is a clearly labeled dummy job for application testing only.',
             'email':'testing@example.com','applyUrl':'','phone':'','salaryMin':None,'salaryMax':None}
        status,res=self.api('POST','/api/jobs',job); self.assertEqual(status,201,res)
        jid=res['id']; app={'jobId':jid,'fullName':'Alice Test','email':'applicant@test.example','phone':'',
            'country':'Kenya','city':'Nairobi','experience':'One year cleaning houses',
            'message':'I have experience with household cleaning, laundry and housekeeping.', 'consent':True}
        status,res=self.api('POST','/api/applications',app)
        self.assertEqual(status,400) # pending jobs cannot accept applications
        status,_=self.api('PATCH',f'/api/admin/jobs/{jid}',{'status':'approved'},admin=True)
        self.assertEqual(status,200)
        app['consent']=False
        status,_=self.api('POST','/api/applications',app);self.assertEqual(status,400)
        app['consent']=True
        status,receipt=self.api('POST','/api/applications',app);self.assertEqual(status,201,receipt)
        self.assertIn('withdrawalCode',receipt);aid=receipt['id']
        self.assertIn('not sent',receipt['message'])
        status,_=self.api('GET','/api/applications');self.assertEqual(status,404)
        status,_=self.api('GET','/api/admin/applications');self.assertEqual(status,401)
        status,admin=self.api('GET','/api/admin/applications',admin=True);self.assertEqual(status,200)
        saved=next(a for a in admin['applications'] if a['id']==aid)
        self.assertEqual(saved['email'],'applicant@test.example');self.assertEqual(saved['status'],'pending')
        status,_=self.api('PATCH',f'/api/admin/applications/{aid}',{'status':'reviewed'},admin=True);self.assertEqual(status,200)
        status,_=self.api('PATCH',f'/api/admin/applications/{aid}',{'status':'approved'},admin=True);self.assertEqual(status,400)
        status,_=self.api('DELETE',f'/api/applications/{aid}',{'withdrawalCode':'invalid'});self.assertEqual(status,403)
        status,_=self.api('DELETE',f'/api/applications/{aid}',{'withdrawalCode':receipt['withdrawalCode']});self.assertEqual(status,200)
        status,admin=self.api('GET','/api/admin/applications',admin=True)
        self.assertNotIn(aid,[a['id'] for a in admin['applications']])

if __name__=='__main__':unittest.main()
