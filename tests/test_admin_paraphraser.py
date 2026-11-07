"""Tests for private owner paraphrasing; no external API calls or stored text."""
import io
import json
import unittest
from unittest.mock import patch

import admin_paraphraser as tool


class FakeHandler:
    def __init__(self, payload):
        self.allowed=True
        self.csrf=True
        self.client_address=('127.0.0.1',12345)
        self.headers={'Content-Type':'application/json'}
        raw=json.dumps(payload).encode('utf-8')
        self.headers['Content-Length']=str(len(raw))
        self.rfile=io.BytesIO(raw)
        self.results=[]
    def admin_session(self): return {'owner':1} if self.allowed else None
    def admin_write_authorized(self): return self.csrf
    def send_json(self,code,data):
        self.results.append((code,data))
        return (code,data)


class ParaphraserTests(unittest.TestCase):
    def test_word_limits_and_styles(self):
        for text in ['A','hi there','  Singleword  ', 'a '*3000]:
            src, tone, n=tool.validate_request({'text':text,'tone':'natural'})
            self.assertEqual(n,tool.count_words(text))
            self.assertTrue(src)
        with self.assertRaisesRegex(ValueError,'3,000'):
            tool.validate_request({'text':'a '*3001})
        with self.assertRaisesRegex(ValueError,'some text'):
            tool.validate_request({'text':' '})
        with self.assertRaisesRegex(ValueError,'supported'):
            tool.validate_request({'text':'hello','tone':'unknown'})

    def test_admin_only_csrf_and_size_checks(self):
        calls=[]
        rewrite=lambda text,tone,n: calls.append(text) or 'Rewritten content.'
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        handle.allowed=False
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)[0],401)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        handle.csrf=False
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)[0],403)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:False,rewrite)[0],429)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'x '*3001,'tone':'simple'})
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)[0],400)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        code, result=tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)
        self.assertEqual(code,200)
        self.assertEqual(result['outputWords'],2)
        self.assertIsNone(result['detectorScore'])
        self.assertEqual(calls,['Private draft'])

    def test_api_secret_is_server_side_and_store_disabled(self):
        response={'output':[{'type':'message','content':[{'type':'output_text','text':'A natural rewrite.'}]}]}
        captured=[]
        class FakeResponse:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps(response).encode('utf-8')
        def fake_open(request,timeout):
            captured.append(request)
            return FakeResponse()
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-private-token','PARAPHRASER_MODEL':'gpt-4.1-mini'}):
            with patch('urllib.request.urlopen',side_effect=fake_open):
                out=tool.rewrite_via_openai('Original sentence.','natural',2)
        self.assertEqual(out,'A natural rewrite.')
        payload=json.loads(captured[0].data)
        self.assertFalse(payload['store'])
        self.assertEqual(payload['model'],'gpt-4.1-mini')
        self.assertEqual(captured[0].get_header('Authorization'),'Bearer test-private-token')
        self.assertEqual(len(captured),1)

    def test_no_key_fails_cleanly(self):
        with patch.dict('os.environ',{'OPENAI_API_KEY':''}):
            with self.assertRaisesRegex(RuntimeError,'not configured'):
                tool.rewrite_via_openai('Text','natural',1)


if __name__=='__main__':
    unittest.main()
