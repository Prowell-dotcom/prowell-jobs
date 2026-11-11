"""OpenAI public Humanizer security, budget and output validation tests."""
import io
import json
import unittest
from unittest.mock import patch

import admin_paraphraser as core
import prowell_openai_rewrite as paid


class Handler:
    def __init__(self, payload):
        self.client_address = ("127.0.0.1", 3333)
        raw = json.dumps(payload).encode()
        self.headers = {"Content-Type": "application/json",
                        "Content-Length": str(len(raw))}
        self.rfile = io.BytesIO(raw)

    def send_json(self, status, data):
        return status, data


class OpenAIRewriteTests(unittest.TestCase):
    SOURCE = ("The clinic contacted patients before scheduled appointments. "
              "Nurses confirmed appointments and recorded transportation concerns.")
    GOOD = ("Before their scheduled appointments, the clinic reached patients. "
            "Nurses verified appointments and documented transportation concerns.")

    def configuration(self):
        return patch.dict("os.environ", {
            "PROWELL_PUBLIC_OPENAI_ENABLED": "1",
            "OPENAI_API_KEY": "placeholder-for-unit-tests",
            "PROWELL_OPENAI_MODEL": "gpt-4.1-mini",
            "PROWELL_OPENAI_DAILY_LIMIT": "20",
        })

    def test_opt_in_required_even_with_key(self):
        with patch.dict("os.environ", {
            "PROWELL_PUBLIC_OPENAI_ENABLED": "0",
            "OPENAI_API_KEY": "placeholder",
        }):
            self.assertFalse(paid.enabled())
            self.assertFalse(paid.capabilities()["openaiAvailable"])

    def test_good_rewrite_is_returned_and_validated(self):
        with self.configuration(), patch.object(
            core, "_request_rewrite", return_value=self.GOOD
        ) as request:
            result = paid.rewrite(self.SOURCE, self.SOURCE, "student", 9)
        self.assertEqual(result["paraphrased"], self.GOOD)
        self.assertEqual(request.call_count, 1)

    def test_protected_numbers_still_rejected(self):
        source = self.SOURCE.replace("appointments.", "appointments in 2025.")
        invalid = self.GOOD.replace("appointments.", "appointments in 2024.")
        with self.configuration(), patch.object(
            core, "_request_rewrite", return_value=invalid
        ) as request:
            with self.assertRaises(paid.ProviderUnavailable):
                paid.rewrite(source, source, "student", 9)
        self.assertEqual(request.call_count, 2)

    def test_public_endpoint_is_rate_limited(self):
        payload = {"text":self.SOURCE, "tone":"student",
                   "engine":"openai", "level":9}
        seen = []
        with self.configuration(), patch.object(
            paid, "rewrite", return_value={
                "paraphrased":self.GOOD, "candidateCount":1,
                "validCandidateCount":1,
                "enginePipeline":"openai_editorial_verified",
                "editorialPass":"validated", "verificationMethods":[],
            }
        ):
            code, data = core.handle_public_rewrite(
                Handler(payload),
                lambda ip, name, limit: seen.append((name, limit)) or True)
        self.assertEqual(code, 200)
        self.assertEqual(data["engine"], "openai")
        self.assertIn(("public-paraphrase-openai",3), seen)

    def test_daily_quota_reservation(self):
        with self.configuration(), patch.object(paid, "_USED", 20), patch.object(
                paid, "_WINDOW_STARTED", paid.time.monotonic()):
            with self.assertRaisesRegex(paid.ProviderUnavailable,"daily usage"):
                paid._reserve()

    def test_no_key_never_calls_provider(self):
        with patch.dict("os.environ",{
            "PROWELL_PUBLIC_OPENAI_ENABLED":"1",
            "OPENAI_API_KEY":""}):
            with patch.object(core, "_request_rewrite") as request:
                with self.assertRaises(paid.ProviderUnavailable):
                    paid.rewrite(self.SOURCE,self.SOURCE,"student",9)
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
