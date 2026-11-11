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

    def test_quoted_homeland_security_example_remains_grammatical(self):
        original = (
            "The department of homeland security's 2025 Homeland Threat "
            "Assessment outlines threats that are shared in the realm of "
            "critical infrastructure, hostile state activity, drug "
            "trafficking, and terrorism. "
            "This paper considers the requirements of home security in "
            "the United States and attempts to answer the question of "
            "whether the United States homeland security system can "
            "maintain those risks using materials provided in the chapters "
            "covered in the course textbook material. "
            "Antiterrorism, national response strategy, chemical and "
            "biological threats, the homeland security cycle, incident "
            "command, political and legal constraints, cybersecurity, "
            "and domain security are considered. "
            "Existing arrangements, as outlined by government guidance "
            "and oversight, are strong due to the presence of common "
            "terminology, the coordinated system of responses, and "
            "counterterrorism partnerships. "
            "Nevertheless, gaps in critical infrastructure protection, "
            "interoperable working with private sector operators, and "
            "resilience against multiple disruptions have not yet been "
            "addressed. "
            "The paper finds the system is moderately ready to sustain "
            "familiar emergencies, but is poorly prepared if cascading "
            "failures occur. "
            "It suggests that there is one priority: a nationwide "
            "program to assess the readiness of all sectors and confirm "
            "corrective measures taken prior to disasters or attacks."
        )
        rewritten = self.edit(original)
        self.assertTrue(editor._safe_output(original, rewritten))
        self.assertIn("2025", rewritten)
        self.assertIn("but is poorly prepared if cascading failures occur",
                      rewritten)
        self.assertNotIn("Although the paper finds", rewritten)
        self.assertNotIn(", is poorly prepared", rewritten)
        self.assertIn("examines whether", rewritten)
        self.assertIn("before disasters or attacks", rewritten)

    def test_contrast_rewrite_requires_explicit_second_subject(self):
        unsafe = (
            "The system can respond to small emergencies, "
            "but is poorly prepared for cascading failures."
        )
        self.assertEqual(editor._reframe_contrast(unsafe), unsafe)
        self.assertFalse(editor._local_grammar_ok(
            unsafe, "Although the system can respond to small emergencies, "
                    "is poorly prepared for cascading failures."
        ))
        with_subject = (
            "Nurses contacted patients, but several did not respond."
        )
        self.assertEqual(
            editor._reframe_contrast(with_subject),
            "Although nurses contacted patients, several did not respond."
        )
        nested_assertion = (
            "The study finds the clinic can respond quickly, "
            "but patients may still miss appointments."
        )
        self.assertEqual(
            editor._reframe_contrast(nested_assertion), nested_assertion
        )

    def test_very_light_edit_is_not_claimed_to_be_full_humanization(self):
        source = (
            "The agency outlined major risks and possible responses. "
            "The team discussed national coordination, communication, "
            "preparedness, partnerships, and legal responsibilities. "
            "The report includes several examples of ongoing issues "
            "without making definitive claims about their future outcomes. "
            "Nevertheless, the team believes that additional planning "
            "and review remain important for the coming years."
        )
        handler = Handler({"text": source, "tone":"student", "engine":"local"})
        code, response = editor.handle_public_rewrite(
            handler, lambda *args, **kwargs: True)
        self.assertEqual(code, 200)
        self.assertEqual(response["engine"], "local")
        self.assertIsInstance(response["qualityWarning"], str)
        self.assertIn("not a full paraphrase", response["qualityWarning"])
        self.assertLess(response["editableTextChangePercent"], 20)
        self.assertIn("paraphrased", response)
        self.assertTrue(editor._safe_output(source, response["paraphrased"]))

    def test_ten_levels_produce_progressively_stronger_safe_edits(self):
        original = (
            "It is important to note that this paper considers public "
            "policy using materials provided in the course textbook."
        )
        light = editor.rewrite_via_local(
            original, "student", editor.count_words(original), level=1)
        deep = editor.rewrite_via_local(
            original, "student", editor.count_words(original), level=10)
        self.assertTrue(editor._safe_output(original, light))
        self.assertTrue(editor._safe_output(original, deep))
        self.assertIn("this paper considers", light.lower())
        self.assertIn("this paper examines", deep.lower())
        self.assertIn("drawing on the course textbook", deep.lower())
        self.assertGreater(
            editor._rewrite_edit_metrics(original, deep)[
                "editableTextChangePercent"],
            editor._rewrite_edit_metrics(original, light)[
                "editableTextChangePercent"],
        )

    def test_all_ten_levels_preserve_medical_names_and_figures(self):
        original = (
            "It is important to note that 25% of patients with "
            "hypertension took metformin before their appointments. "
            "The remaining participants paid $1,200 & attended @ clinic."
        )
        for level in range(1, 11):
            with self.subTest(level=level):
                result = editor.rewrite_via_local(
                    original, "student", editor.count_words(original), level=level)
                self.assertTrue(editor._safe_output(original, result))
                for fragment in ("25%", "hypertension", "metformin",
                                 "$1,200", "&", "@"):
                    self.assertIn(fragment, result)

    def test_public_api_rejects_invalid_levels(self):
        for level in (0, 11, -5, 2.5, "10", True, None):
            with self.subTest(level=level):
                request = Handler({
                    "text": "It is important to note that the clinic is open.",
                    "tone": "student", "engine": "local", "level": level
                })
                status, payload = editor.handle_public_rewrite(
                    request, lambda *args, **kwargs: True)
                self.assertEqual(status, 400)
                self.assertIn("level", payload["error"].lower())

    def test_requested_level_and_light_edit_warning_are_reported(self):
        original = (
            "The agency outlined major risks and possible responses. "
            "The team discussed national coordination, communication, "
            "preparedness, partnerships, and legal responsibilities. "
            "The report includes several examples of ongoing issues "
            "without making definitive claims about their future outcomes. "
            "Nevertheless, the team believes that additional planning "
            "and review remain important for the coming years."
        )
        code, data = editor.handle_public_rewrite(
            Handler({"text": original, "tone": "student",
                     "engine": "local", "level": 10}),
            lambda *args, **kwargs: True)
        self.assertEqual(code, 200)
        self.assertEqual(data["levelRequested"], 10)
        self.assertIn("not a full paraphrase", data["qualityWarning"])
        self.assertTrue(editor._safe_output(original, data["paraphrased"]))

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
