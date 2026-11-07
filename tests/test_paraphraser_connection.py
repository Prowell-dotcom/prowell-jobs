"""Connection diagnostics avoid user drafts and expose safe provider messages."""
import unittest
from unittest.mock import patch
import admin_paraphraser as paraphraser

class Handler:
    def __init__(self,session=True,csrf=True):
        self.session=session
        self.csrf=csrf
        self.client_address=("127.0.0.1",9000)
        self.returned=None
    def admin_session(self):
        return {"owner":1} if self.session else None
    def admin_write_authorized(self):
        return self.csrf
    def send_json(self,status,body):
        self.returned=(status,body)
        return self.returned

class ConnectionTest(unittest.TestCase):
    def test_auth_required_before_key_or_provider_calls(self):
        requests=[]
        def fake(*args):
            requests.append(args)
            return "READY"
        for session,csrf,expected in [(False,True,401),(True,False,403)]:
            handler=Handler(session,csrf)
            with patch.dict("os.environ",{"GEMINI_API_KEY":"secret-test-key"}):
                code,body=paraphraser.check_connection(handler,lambda *a,**kw:True,gemini_request=fake)
            self.assertEqual(code,expected)
            self.assertEqual(requests,[])

    def test_missing_api_key_is_actionable(self):
        with patch.dict("os.environ",{"PARAPHRASER_PROVIDER":"gemini","GEMINI_API_KEY":""}):
            code,body=paraphraser.check_connection(Handler(),lambda *a,**kw:True)
        self.assertEqual(code,200)
        self.assertFalse(body["connected"])
        self.assertIn("GEMINI_API_KEY",body["message"])

    def test_live_test_uses_only_fixed_sample_not_pasted_text(self):
        seen=[]
        def fake(api_key,model,instructions,prompt):
            seen.append((api_key,model,prompt))
            return "READY"
        with patch.dict("os.environ",{"PARAPHRASER_PROVIDER":"gemini",
             "GEMINI_API_KEY":"secret-test-key","GEMINI_MODEL":"gemini-3.8-flash"}):
            code,body=paraphraser.check_connection(
                Handler(),lambda *a,**kw:True,gemini_request=fake)
        self.assertEqual(code,200)
        self.assertTrue(body["connected"])
        self.assertEqual(seen,[("secret-test-key","gemini-3.8-flash","READY")])
        self.assertNotIn("secret-test-key",repr(body))

    def test_provider_denial_and_api_key_quotes(self):
        with patch.dict("os.environ",{"PARAPHRASER_PROVIDER":"gemini",
             "GEMINI_API_KEY":"'with-quotes'"}):
            code,body=paraphraser.check_connection(Handler(),lambda *a,**kw:True)
        self.assertFalse(body["connected"])
        self.assertIn("quotes",body["message"])
        def blocked(*args):
            raise RuntimeError("Gemini model unavailable for this project.")
        with patch.dict("os.environ",{"PARAPHRASER_PROVIDER":"gemini",
             "GEMINI_API_KEY":"sample"}):
            code,body=paraphraser.check_connection(
                Handler(),lambda *a,**kw:True,gemini_request=blocked)
        self.assertFalse(body["connected"])
        self.assertIn("model unavailable",body["message"])

if __name__ == "__main__":
    unittest.main()
