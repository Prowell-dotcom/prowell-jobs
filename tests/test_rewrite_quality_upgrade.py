"""Quality-upgrade regression tests for the Prowell Humanizer."""
import unittest
from unittest.mock import patch

import admin_paraphraser as core
import prowell_rewrite_quality as quality
import prowell_openai_rewrite as openai
import prowell_gemini_rewrite as gemini


class RewriteQualityUpgradeTests(unittest.TestCase):
    SOURCE = (
        "The clinic contacted patients before scheduled appointments. "
        "Nurses confirmed appointments and recorded transportation concerns."
    )
    GOOD = (
        "Before their scheduled appointments, the clinic reached patients. "
        "Nurses verified appointments and documented transportation concerns."
    )

    def config(self):
        return patch.dict("os.environ", {
            "PROWELL_PUBLIC_OPENAI_ENABLED": "1",
            "OPENAI_API_KEY": "unit-test-key",
            "PROWELL_OPENAI_MODEL": "gpt-4.1-mini",
            "PROWELL_OPENAI_DAILY_LIMIT": "20",
            "PROWELL_PUBLIC_GEMINI_ENABLED": "1",
            "GEMINI_API_KEY": "unit-test-key",
            "PROWELL_GEMINI_MODEL": "gemini-3.8-flash",
            "PROWELL_GEMINI_DAILY_LIMIT": "20",
        })

    def test_level_specific_instructions(self):
        light = quality.instructions("student", 2)
        balanced = quality.instructions("student", 6)
        deep = quality.instructions("student", 10)
        self.assertIn("LIGHT EDIT:", light)
        self.assertIn("BALANCED REWRITE:", balanced)
        self.assertIn("DEEP EDIT:", deep)
        self.assertIn("Preserve every original claim", deep)
        self.assertIn("Return ONLY", deep)
        self.assertNotIn("DEEP EDIT:", light)

    def test_accurate_rewrite_passes(self):
        result = quality.evaluate(
            self.SOURCE, self.SOURCE, self.GOOD, (), (), 9
        )
        self.assertTrue(result["passed"])
        self.assertGreater(result["score"], 0)

    def test_changed_fact_is_rejected_at_any_level(self):
        source = self.SOURCE + " The follow-up occurred in 2025."
        wrong = self.GOOD + " The follow-up occurred in 2024."
        for level in (1, 5, 10):
            with self.subTest(level=level):
                result = quality.evaluate(source, source, wrong, (), (), level)
                self.assertFalse(result["passed"])
                self.assertEqual(result["reason"], "protected_details")

    def test_high_intensity_selects_better_second_candidate(self):
        first = "One alternative draft."
        second = "Another alternative draft."
        scores = iter([
            {"passed": True, "score": .61, "text": first},
            {"passed": True, "score": .93, "text": second},
        ])
        with self.config(), patch.object(
            core, "_request_rewrite", side_effect=[first, second]
        ) as request, patch.object(
            quality, "evaluate", side_effect=lambda *a, **k: next(scores)
        ):
            result = openai.rewrite(
                self.SOURCE, self.SOURCE, "student", 10
            )
        self.assertEqual(result["paraphrased"], second)
        self.assertEqual(result["candidateCount"], 2)
        self.assertEqual(request.call_count, 2)

    def test_refinement_outage_retains_verified_first_candidate(self):
        first = "A valid first draft."
        with self.config(), patch.object(
            core, "_request_rewrite",
            side_effect=[first, RuntimeError("API limit")],
        ), patch.object(
            quality, "evaluate",
            return_value={"passed": True, "score": .60, "text": first},
        ):
            result = openai.rewrite(
                self.SOURCE, self.SOURCE, "student", 10
            )
        self.assertEqual(result["paraphrased"], first)
        self.assertEqual(result["candidateCount"], 1)

    def test_gemini_uses_same_level_and_avoids_unnecessary_extra_call(self):
        with self.config(), patch.object(
            core, "_request_gemini", return_value=self.GOOD
        ) as request:
            result = gemini.rewrite(
                self.SOURCE, self.SOURCE, "student", 9
            )
        self.assertEqual(result["paraphrased"], self.GOOD)
        self.assertEqual(request.call_count, 1)
        self.assertIn("DEEP EDIT:", request.call_args.args[2])


if __name__ == "__main__":
    unittest.main()
