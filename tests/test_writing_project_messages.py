"""Customer-only cancellation and private, moderated-project conversation access."""
import json, tempfile, threading, unittest, uuid
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from test_smoke import server

class WritingProjectMessagesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.old_db=server.DATABASE_PATH;cls.old_root=server.WRITING_UPLOAD_ROOT
        server.DATABASE_PATH=Path(cls.tmp.name)/'writing-chat.sqlite3'
        server.WRITING_UPLOAD_ROOT=Path(cls.tmp.name)/'private'
        server.initialize_db()
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.port=cls.httpd.server_address[1]
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.thread.join(timeout=4);cls.httpd.server_close()
        server.DATABASE_PATH=cls.old_db;server.WRITING_UPLOAD_ROOT=cls.old_root
        cls.tmp.cleanup()
    def setUp(self):
        with server.rate_lock:server.submission_times.clear()
    def call(self,method,path,payload=None,user=None):
        h={'Accept':'application/json'}
        if user: h['Cookie']=user['cookie'];h['X-Member-CSRF']=user['csrf']
        if payload is not None:h['Content-Type']='application/json'
        req=Request(f'http://127.0.0.1:{self.port}{path}',
                    data=json.dumps(payload).encode() if payload is not None else None,
                    headers=h,method=method)
        try:r=urlopen(req,timeout=10)
        except HTTPError as err:r=err
        with r:
            d=r.read()
            return r.status,json.loads(d) if r.headers.get('Content-Type','').startswith('application/json') else d
    def user(self,role):
        email=f'{uuid.uuid4().hex}@example.test'
        with patch.object(server,'email_configured',return_value=False):
            code,resp=self.call('POST','/api/member/signup',{
                'fullName':'Sample '+role,'email':email,'role':role,'password':'Demo secure password 123456!','consent':True})
        self.assertEqual(code,200,resp)
        # Separate login to obtain session cookie; original signup cookie is captured here via raw setup alternative.
        token=resp['csrfToken']
        with server.db_connection() as db:
            db.execute('UPDATE members SET emailVerified=1 WHERE id=?',(resp['member']['id'],))
            from accounts import password_hash
            # We cannot use session token from HTTP JSON; authenticate again below.
        # make login using Request and parse Set-Cookie
        data=json.dumps({'email':email,'password':'Demo secure password 123456!'}).encode()
        req=Request(f'http://127.0.0.1:{self.port}/api/member/login',data=data,
                    headers={'Content-Type':'application/json'},method='POST')
        with urlopen(req,timeout=10) as r:
            body=json.load(r); cookie=r.headers['Set-Cookie'].split(';')[0]
        return {'id':resp['member']['id'],'cookie':cookie,'csrf':body['csrfToken']}
    def neworder(self,client):
        code,r=self.call('POST','/api/writing/orders',{
            'title':'Private editing consultation','category':'Proofreading & Editing',
            'publicSummary':'Please review a professional manuscript for clarity and format.',
            'brief':'Confidential private project instructions: correct typos and improve readability.',
            'deadline':'2030-12-25','budgetKES':1400,'integrityConsent':True,
            'attachments':[]},client)
        self.assertEqual(code,201,r)
        return r['id']
    @patch.object(server,'deliver_notification_event',return_value='sent')
    def test_only_owner_can_cancel_open_order(self,_email):
        client=self.user('client');writer=self.user('writer');order=self.neworder(client)
        url=f'/api/writing/orders/{order}/cancel'
        self.assertEqual(self.call('POST',url,{},writer)[0],403)
        self.assertEqual(self.call('POST',url,{},client)[0],200)
        self.assertEqual(self.call('POST',url,{},client)[0],409)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{order}/bids',
            {'amountKES':1200,'days':3,'proposal':'I can provide editing and formatting feedback.'},writer)[0],409)
        self.assertEqual(self.call('GET','/api/writing/orders',user=writer)[1]['orders'],[])
    @patch.object(server,'deliver_notification_event',return_value='sent')
    def test_messages_only_client_and_selected_writer_after_assignment(self,_email):
        client=self.user('client');writer=self.user('writer');other=self.user('writer');order=self.neworder(client)
        path=f'/api/writing/orders/{order}/messages'
        self.assertEqual(self.call('GET',path,user=client)[0],409)
        c,r=self.call('POST',f'/api/writing/orders/{order}/bids',
                      {'amountKES':1200,'days':5,'proposal':'I can improve business document clarity and formatting.'},writer)
        self.assertEqual(c,201,r)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{order}/choose',{'bidId':r['id']},client)[0],200)
        self.assertEqual(self.call('GET',path,user=other)[0],403)
        self.assertEqual(self.call('POST',path,{'body':'This must stay confidential.'},other)[0],403)
        c,r=self.call('POST',path,{'body':'Please prioritize the introduction section.'},client)
        self.assertEqual(c,201,r)
        c,r=self.call('GET',path,user=writer);self.assertEqual(c,200,r)
        self.assertEqual(len(r['messages']),1)
        self.assertIn('introduction',r['messages'][0]['body'])
        c,r=self.call('POST',path,{'body':'Understood; I will focus on the introduction.'},writer)
        self.assertEqual(c,201,r)
        self.assertEqual(len(r['messages']),2)
        # Before the owner account is provisioned, the private setup-key API fallback
        # still permits administrator review; regular members are never authorized.
        req=Request(f'http://127.0.0.1:{self.port}/api/admin/writing/orders/{order}/messages',
                    headers={'Authorization':'Bearer '+server.ADMIN_KEY},method='GET')
        with urlopen(req,timeout=8) as reply:
            self.assertEqual(reply.status,200)
            self.assertEqual(len(json.load(reply)['messages']),2)
        self.assertEqual(self.call('POST',f'/api/writing/orders/{order}/cancel',{},client)[0],409)

if __name__=='__main__':unittest.main()
