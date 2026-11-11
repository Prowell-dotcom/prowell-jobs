"""Regression audit for offline paraphrasing: meaning, fidelity and UX metrics."""
import io
import json
import unittest
from unittest.mock import patch

import admin_paraphraser as editor


class Handler:
    def __init__(self, body):
        self.client_address = ("127.0.0.1", 8000)
        self.payload = body
        raw = json.dumps(body).encode("utf-8")
        self.headers = {"Content-Type":"application/json",
                        "Content-Length":str(len(raw))}
        self.rfile = io.BytesIO(raw)
    def admin_session(self): return {"owner":1}
    def admin_write_authorized(self): return True
    def send_json(self, code, body): return (code, body)


class ParaphraserAudit(unittest.TestCase):
    def edit(self, text, tone="student", terms=()):
        return editor.rewrite_via_local(text, tone, editor.count_words(text),
                                        protected_terms=terms)

    def test_short_quotes_remain_exact_while_prose_changes(self):
        source = ('The writer used "prior to" in a quotation, and staff '
                  'sent their reminders prior to the upcoming appointment.')
        result = self.edit(source)
        self.assertIn('"prior to"', result)
        self.assertIn("before the upcoming appointment", result)
        self.assertTrue(editor._safe_output(source, result))

    def test_short_quoted_literal_word_not_edited(self):
        source = ('The note says "utilized", although the writer utilized '
                  'simple phrases in their discussion.')
        result = self.edit(source)
        self.assertIn('"utilized"', result)
        self.assertIn("writer used simple phrases", result)

    def test_preservation_coverage_matrix(self):
        originals = [
            ("It is important to note that 26.5% of the 1,220 patients "
             "paid $450 & received follow-ups @ clinic.",
             ["26.5%", "1,220", "$450", "&", "@"]),
            ("It is important to note that people with hypertension "
             "took metformin and amlodipine to manage symptoms.",
             ["hypertension", "metformin", "amlodipine"]),
            ("It is important to note that results were published "
             "(Smith et al., 2023) at https://example.org/path.",
             ["(Smith et al., 2023)", "https://example.org/path"]),
            ('It is important to note that the participant said '
             '"I agree" before leaving the room.',
             ['"I agree"']),
            ("It is important to note that Dr. Brown sent follow-ups "
             "to team@example.org in 2024.", ["Dr. Brown", "team@example.org", "2024"]),
        ]
        for source, protected in originals:
            with self.subTest(source=source):
                result = self.edit(source)
                self.assertTrue(editor._safe_output(source, result))
                for fragment in protected:
                    self.assertIn(fragment, result)

    def test_custom_terms_exact_case_and_repetition(self):
        source = ("It is important to note that levetiracetam helped. "
                  "The nurse explained why levetiracetam was prescribed.")
        terms=("levetiracetam",)
        output=self.edit(source, terms=terms)
        self.assertTrue(editor._safe_output(source, output, terms))
        self.assertEqual(output.count("levetiracetam"), 2)

    def test_no_random_synonym_soup(self):
        plain="The nurse visited the patient in the afternoon."
        with self.assertRaisesRegex(RuntimeError,"cannot safely"):
            self.edit(plain)

    def test_do_not_rewrite_medication_dose(self):
        original=("It is important to note that the patient received "
                  "25 mg of metformin twice daily in 2024.")
        rewritten=self.edit(original)
        for exact in ["25", "metformin", "2024"]:
            self.assertIn(exact, rewritten)
        self.assertTrue(editor._safe_output(original, rewritten))

    def test_abbreviations_do_not_capitalize_following_words(self):
        original=("It is important to note that the clinic collected data "
                  "using several measures, e.g. attendance and feedback.")
        result=self.edit(original)
        self.assertIn("e.g. attendance", result)

    def test_edit_strength_does_not_claim_human_authorship(self):
        a=("It is important to note that nurses reminded patients "
           "about appointments on a regular basis.")
        b=self.edit(a)
        score=editor._rewrite_edit_metrics(a,b)
        self.assertIn(score["editStrength"],{"Light","Moderate","Substantial"})
        self.assertTrue(0 <= score["editableTextChangePercent"] <= 100)
        self.assertNotIn("human",str(score).lower())
        self.assertNotIn("detector",str(score).lower())

    def test_long_document_one_edit_is_light(self):
        original=("Nurses reviewed the treatment plan and discussed "
                  "follow-up appointments with every patient. " * 70 +
                  "It is important to note that staff contacted patients.")
        result=self.edit(original)
        score=editor._rewrite_edit_metrics(original,result)
        self.assertEqual(score["editStrength"],"Light")

    def test_local_api_response_reports_engine_and_edit_strength(self):
        text=("It is important to note that staff regularly contacted "
              "patients before their follow-up appointments.")
        with patch("urllib.request.urlopen", side_effect=AssertionError(
                "Local editing must never call external AI APIs")):
            code,payload=editor.handle_rewrite(
                Handler({"text":text,"tone":"student","engine":"local"}),
                lambda *args,**kwargs: True)
        self.assertEqual(code,200)
        self.assertEqual(payload["engine"],"local")
        self.assertIn(payload["editStrength"],{"Light","Moderate","Substantial"})
        self.assertTrue(editor._safe_output(text,payload["paraphrased"]))


if __name__=="__main__":
    unittest.main()
