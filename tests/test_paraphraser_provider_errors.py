"""API error diagnostics and budget regression tests (without external calls)."""
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import admin_paraphraser as p


def provider_error(code, type_, message):
    data=json.dumps({"error":{"code":code,"type":type_,"message":message}}).encode()
    return HTTPError("https://api.openai.com/v1/responses",429,"Too Many Requests",{},io.BytesIO(data))


class ProviderErrorTests(unittest.TestCase):
    def test_quota_and_billing_error(self):
        message=p._describe_api_429(provider_error("insufficient_quota","insufficient_quota",
            "You exceeded your current quota."))
        self.assertIn("credits or spending limit",message)
        self.assertIn("Billing",message)

    def test_temporary_rate_limit(self):
        message=p._describe_api_429(provider_error("rate_limit_exceeded","rate_limit_error",
            "Rate limit reached for requests per minute"))
        self.assertIn("rate limit reached",message)
        self.assertIn("Wait",message)

    def test_unrecognized_429_is_not_misidentified(self):
        message=p._describe_api_429(provider_error(None,None,"Unknown failure"))
        self.assertIn("quota or rate limit",message)

    def test_output_budget_is_adaptive(self):
        sent=[]
        class FakeResponse:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):
                return json.dumps({"output":[{"type":"message","content":[{"type":"output_text","text":"Revised."}]}]}).encode()
        def send(req,timeout):
            sent.append(json.loads(req.data))
            return FakeResponse()
        with patch("urllib.request.urlopen",side_effect=send):
            p._request_rewrite("testkey","gpt-4.1","Edit naturally",
                "SOURCE:\n<source>\nShort sample text.\n</source>")
            p._request_rewrite("testkey","gpt-4.1","Edit naturally",
                "SOURCE:\n<source>\n"+("word "*3000)+"\n</source>")
        self.assertLess(sent[0]["max_output_tokens"],sent[1]["max_output_tokens"])
        self.assertLessEqual(sent[1]["max_output_tokens"],8000)
        self.assertFalse(sent[0]["store"])

if __name__=="__main__":
    unittest.main()
