"""Mocked tests for the free-tier Gemini paraphraser. No network calls."""
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import admin_paraphraser as p


class FakeResponse:
    def __init__(self, text):
        self.text=text
    def __enter__(self):
        return self
    def __exit__(self,*args):
        pass
    def read(self):
        return json.dumps({
            "candidates":[{"content":{"parts":[{"text":self.text}]},
            "finishReason":"STOP"}]
        }).encode()


class GeminiIntegrationTests(unittest.TestCase):
    def test_gemini_default_does_not_require_openai_api_key(self):
        steps=[]
        def fake_request(key,model,instructions,prompt):
            steps.append((key,model,instructions))
            return ("The results improved by 12% in 2025." if len(steps)==1
                    else "In 2025, the results improved by 12%.")
        with patch.dict("os.environ",{
            "GEMINI_API_KEY":"test-key","OPENAI_API_KEY":"",
            "PARAPHRASER_PROVIDER":"gemini",
            "GEMINI_SECOND_PASS":"0"},clear=False):
            with patch.object(p,"_request_gemini",side_effect=fake_request):
                result=p.rewrite_via_provider(
                    "In 2025, results showed a 12% improvement.","natural",8)
        self.assertEqual(len(steps),1)  # one-call default avoids extra quota cost
        self.assertEqual(steps[0][1],"gemini-3.8-flash")
        self.assertIn("12%",result)
        self.assertIn("2025",result)

    def test_default_without_gemini_key_returns_setup_instructions(self):
        with patch.dict("os.environ",{"GEMINI_API_KEY":"",
             "PARAPHRASER_PROVIDER":"gemini"},clear=False):
            with self.assertRaisesRegex(RuntimeError,"GEMINI_API_KEY"):
                p.rewrite_via_provider("A sample.","simple",2)

    def test_gemini_endpoint_payload_and_key_are_private(self):
        calls=[]
        def fake_send(request,timeout):
            calls.append((request,timeout))
            return FakeResponse("This sentence reads naturally.")
        with patch("urllib.request.urlopen",side_effect=fake_send):
            out=p._request_gemini("secret-test-key","gemini-3.8-flash",
                "Edit for grammar.","SOURCE:\n<source>\nAwkward source.\n</source>")
        self.assertEqual(out,"This sentence reads naturally.")
        req,_=calls[0]
        self.assertIn("gemini-3.8-flash:generateContent",req.full_url)
        self.assertEqual(req.get_header("X-goog-api-key"),"secret-test-key")
        data=json.loads(req.data)
        self.assertEqual(data["systemInstruction"]["parts"][0]["text"],
                         "Edit for grammar.")
        self.assertEqual(data["generationConfig"]["thinkingConfig"],
                         {"thinkingLevel":"low"})
        self.assertNotIn("temperature",data["generationConfig"])
        self.assertIn("Awkward source.",json.dumps(data))
        self.assertNotIn("secret-test-key",req.data.decode())

    def test_gemini_429_is_explained_without_leaking_key(self):
        err=HTTPError("https://generativelanguage.googleapis.com",429,
            "Too Many Requests",{},io.BytesIO(b'{}'))
        with patch("urllib.request.urlopen",side_effect=err):
            with self.assertRaisesRegex(RuntimeError,"free-tier"):
                p._request_gemini("sensitive-key","gemini-3.8-flash",
                    "Write naturally.","Test")
                
    def test_rejects_unreliable_rewrite_instead_of_claiming_success(self):
        calls=[]
        def fake_request(*args):
            calls.append(1)
            return ("In 2024, 9% improved." if len(calls)==1
                else "In 2024, 20% improved.")
        with patch.dict("os.environ",{
            "GEMINI_API_KEY":"test-key",
            "PARAPHRASER_PROVIDER":"gemini"},clear=False):
            with patch.object(p,"_request_gemini",side_effect=fake_request):
                with self.assertRaisesRegex(RuntimeError, "protected facts"):
                    p.rewrite_via_provider("In 2024, 9% improved.","academic",5)
        self.assertEqual(len(calls), 2, "One near-copy retry must not alter numbers")

if __name__=="__main__":
    unittest.main()
