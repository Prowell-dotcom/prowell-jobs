"""Safety and integration checks for the opt-in public Gemini editor."""
import io
import json
import unittest
from unittest.mock import patch

import admin_paraphraser as editor
import prowell_gemini_rewrite as gemini


class FakeHandler:
    def __init__(self, payload):
        self.client_address = ("127.0.0.1", 5678)
        raw = json.dumps(payload).encode()
        self.headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(raw)),
        }
        self.rfile = io.BytesIO(raw)

    def send_json(self, status, data):
        return status, data


class GeminiRewriteTests(unittest.TestCase):
    ORIGINAL = (
        "The clinic contacted patients before scheduled appointments. "
        "Nurses confirmed appointments and recorded transportation concerns."
    )
    REWRITE = (
        "Before their scheduled appointments, the clinic reached patients. "
        "Nurses verified appointments and documented transportation concerns."
    )

    def enabled(self):
        return patch.dict("os.environ", {
            "PROWELL_PUBLIC_GEMINI_ENABLED": "1",
            "GEMINI_API_KEY": "placeholder-for-test-only",
            "PROWELL_GEMINI_MODEL": "gemini-3.8-flash",
            "PROWELL_GEMINI_DAILY_LIMIT": "10",
        })

    def test_disabled_even_when_key_exists(self):
        with patch.dict("os.environ", {
            "PROWELL_PUBLIC_GEMINI_ENABLED": "0",
            "GEMINI_API_KEY": "placeholder",
        }):
            self.assertFalse(gemini.enabled())
            self.assertFalse(gemini.capabilities()["geminiAvailable"])

    def test_provider_returns_valid_rewrite(self):
        with self.enabled(), patch.object(
            editor, "_request_gemini", return_value=self.REWRITE
        ) as provider:
            result = gemini.rewrite(self.ORIGINAL, self.ORIGINAL, "student", 9)
        self.assertEqual(result["paraphrased"], self.REWRITE)
        provider.assert_called_once()

    def test_invalid_factual_change_is_rejected(self):
        original = self.ORIGINAL + " The follow-up occurred in 2025."
        altered = self.REWRITE + " The follow-up occurred in 2024."
        with self.enabled(), patch.object(
            editor, "_request_gemini", return_value=altered
        ) as provider:
            with self.assertRaises(gemini.GeminiUnavailable):
                gemini.rewrite(original, original, "student", 9)
        self.assertEqual(provider.call_count, 2)

    def test_public_request_requires_explicit_gemini_selection(self):
        with self.enabled(), patch.object(
            gemini, "rewrite",
            return_value={
                "paraphrased": self.REWRITE,
                "candidateCount": 1,
                "validCandidateCount": 1,
                "enginePipeline": "gemini_editorial_verified",
                "editorialPass": "validated",
                "verificationMethods": [],
            }
        ) as rewrite:
            seen = []
            code, result = editor.handle_public_rewrite(
                FakeHandler({
                    "text": self.ORIGINAL, "tone": "student",
                    "engine": "gemini", "level": 9,
                }),
                lambda ip, name, limit: seen.append((name, limit)) or True,
            )
        self.assertEqual(code, 200)
        self.assertEqual(result["engine"], "gemini")
        self.assertIn(("public-paraphrase-gemini", 3), seen)
        rewrite.assert_called_once()

    def test_api_is_not_called_if_disabled(self):
        with patch.dict("os.environ", {
            "PROWELL_PUBLIC_GEMINI_ENABLED": "0",
            "GEMINI_API_KEY": "placeholder",
        }), patch.object(editor, "_request_gemini") as provider:
            with self.assertRaises(gemini.GeminiUnavailable):
                gemini.rewrite(self.ORIGINAL, self.ORIGINAL, "student", 9)
            provider.assert_not_called()

    def test_daily_budget_is_respected(self):
        with self.enabled(), patch.object(gemini, "_USED", 10), patch.object(
            gemini, "_WINDOW_STARTED", gemini.time.monotonic()
        ):
            with self.assertRaisesRegex(gemini.GeminiUnavailable, "daily usage"):
                gemini._reserve()


if __name__ == "__main__":
    unittest.main()
