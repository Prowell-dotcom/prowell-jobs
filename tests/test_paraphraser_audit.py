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

    def test_level_ten_can_rebuild_structures_without_changed_facts(self):
        original = (
            "The clinic contacted patients before scheduled follow-up appointments. "
            "Staff used reminder calls to confirm appointments. "
            "The results were documented by nurses."
        )
        revised = editor.rewrite_via_local(
            original, "student", editor.count_words(original), level=10)
        self.assertIn(
            "Before scheduled follow-up appointments, the clinic contacted patients.",
            revised
        )
        self.assertIn(
            "Using reminder calls, staff confirmed appointments.", revised
        )
        self.assertIn(
            "Nurses documented the results.", revised
        )
        self.assertTrue(editor._safe_output(original, revised))
        self.assertTrue(editor._local_grammar_ok(original, revised))
        change = editor._rewrite_edit_metrics(original, revised)
        self.assertGreaterEqual(change["editableTextChangePercent"], 23)

    def test_structural_changes_do_not_touch_medical_terms_or_numbers(self):
        original = (
            "The clinic contacted patients before scheduled visits in 2025. "
            "Staff used reminder calls to contact patients. "
            "The outcomes were documented by nurses. "
            "The patients had hypertension and received metformin at $45. "
            "A total of 25% of visits involved follow-up & documentation @ clinic."
        )
        revised = editor.rewrite_via_local(
            original, "student", editor.count_words(original), level=10)
        self.assertTrue(editor._safe_output(original, revised))
        for part in ("2025", "hypertension", "metformin", "$45", "25%", "&", "@"):
            self.assertIn(part, revised)

    def test_level_nine_near_copy_is_not_reported_success(self):
        paragraph = (
            "The regional team examined administrative records across several "
            "departments and presented its observations to local leaders. "
            "Participants described the circumstances surrounding their daily "
            "responsibilities and reported their experiences with routine tasks. "
            "The final report summarized these observations for an internal audience."
        )
        status, payload = editor.handle_public_rewrite(
            Handler({"text":paragraph, "tone":"student",
                     "level":9, "engine":"local"}),
            lambda *args, **kwargs:True
        )
        self.assertEqual(status, 422)
        self.assertTrue(
            "No substantial paraphrase" in payload["error"] or
            "needs context-sensitive rewriting" in payload["error"]
        )
        self.assertNotIn("paraphrased", payload)

    def test_low_edit_level_stays_available_for_light_proofreading(self):
        paragraph = (
            "It is important to note that the regional team examined "
            "administrative records across several departments. "
            "The group presented its observations to local leaders "
            "before the end of the reporting period."
        )
        status, payload = editor.handle_public_rewrite(
            Handler({"text":paragraph, "tone":"student",
                     "level":2, "engine":"local"}),
            lambda *args, **kwargs:True
        )
        self.assertEqual(status, 200)
        self.assertIn("paraphrased", payload)
        self.assertTrue(editor._safe_output(paragraph, payload["paraphrased"]))

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
        self.assertEqual(code, 422)
        self.assertNotIn("paraphrased", data)
        self.assertIn("No substantial paraphrase", data["error"])

    def test_rehumanize_uses_current_result_and_keeps_original_intact(self):
        original = (
            "It is important to note that this paper considers "
            "2025 homeland security threats."
        )
        first_request = Handler({
            "text": original, "engine": "local",
            "tone": "student", "level": 10
        })
        status, first = editor.handle_public_rewrite(
            first_request, lambda *args, **kwargs: True)
        self.assertEqual(status, 200)
        self.assertIn("This paper examines", first["paraphrased"])
        revised = first["paraphrased"]
        second_request = Handler({
            "text": revised, "originalText": original,
            "engine": "local", "mode": "again", "attempt": 1,
            "tone": "student", "level": 10
        })
        status, second = editor.handle_public_rewrite(
            second_request, lambda *args, **kwargs: True)
        self.assertEqual(status, 200)
        self.assertEqual(second["mode"], "again")
        self.assertEqual(second["revisionNumber"], 1)
        self.assertIn("This paper looks at", second["paraphrased"])
        self.assertNotEqual(revised, second["paraphrased"])
        self.assertTrue(editor._safe_output(original, second["paraphrased"]))
        self.assertEqual(
            original,
            "It is important to note that this paper considers "
            "2025 homeland security threats."
        )

    def test_rehumanize_retains_medical_terms_figures_symbols(self):
        original = (
            "It is important to note that this paper considers "
            "2025 follow-up results for 25% of patients with hypertension "
            "taking metformin at a cost of $90 & receiving services @ clinic."
        )
        first = editor.rewrite_via_local(
            original, "student", editor.count_words(original), level=10)
        request = Handler({
            "text": first, "originalText": original,
            "tone": "student", "level": 10, "mode": "again",
            "attempt": 1
        })
        code, data = editor.handle_public_rewrite(
            request, lambda *args, **kwargs: True)
        # The stricter high-depth endpoint must reject an insufficient second
        # pass rather than advertise near-copied text as deep paraphrasing.
        self.assertIn(code, (200, 422))
        if code == 200:
            self.assertTrue(editor._safe_output(original, data["paraphrased"]))
            self.assertNotEqual(data["paraphrased"], first)
            candidate = data["paraphrased"]
        else:
            self.assertNotIn("paraphrased", data)
            self.assertIn("No substantial paraphrase", data["error"])
            candidate = first
        for unchanged in (
            "2025", "25%", "hypertension", "metformin",
            "$90", "&", "@"
        ):
            self.assertIn(unchanged, candidate)

    def test_rehumanize_refuses_fabricated_rewrites(self):
        original = "The nurse read the patient's letter carefully."
        request = Handler({
            "text": original, "originalText": original,
            "tone": "natural", "level": 10,
            "mode": "again", "attempt": 1
        })
        code, data = editor.handle_public_rewrite(
            request, lambda *args, **kwargs: True)
        self.assertEqual(code, 422)
        self.assertNotIn("paraphrased", data)
        self.assertIn("No further safe rewording", data["error"])

    def test_rehumanize_rejects_invalid_attempt_or_changed_facts(self):
        original = (
            "It is important to note that this paper considers "
            "25% of patients receiving metformin."
        )
        current = (
            "This paper examines 25% of patients receiving metformin."
        )
        for wrong in (0, -1, 21, 1.5, "1", True, None):
            with self.subTest(attempt=wrong):
                code, response = editor.handle_public_rewrite(
                    Handler({
                        "text": current, "originalText": original,
                        "tone": "student", "level": 10,
                        "mode": "again", "attempt": wrong
                    }), lambda *args, **kwargs: True)
                self.assertEqual(code, 400)
                self.assertIn("attempt", response["error"].lower())
        for change in (
            current.replace("25%", "26%"),
            current.replace("metformin", "insulin")
        ):
            with self.subTest(current=change):
                code, response = editor.handle_public_rewrite(
                    Handler({
                        "text": change, "originalText": original,
                        "tone": "student", "level": 10,
                        "mode": "again", "attempt": 1
                    }), lambda *args, **kwargs: True)
                self.assertEqual(code, 400)
                self.assertIn("protected", response["error"].lower())

    def test_rehumanize_public_flow_uses_rate_limiter(self):
        source = ("This paper examines the results of a safety assessment.")
        calls = []
        request = Handler({
            "text": source, "originalText": source,
            "tone": "student", "mode": "again", "attempt": 1, "level": 9
        })
        editor.handle_public_rewrite(
            request, lambda ip, name, limit: calls.append((name,limit)) or True)
        self.assertEqual(calls, [("public-paraphrase-local", 24)])

    def test_stronger_local_academic_rules_at_high_depth(self):
        original = (
            "The report emphasizes the findings in conjunction with a "
            "discussion of community needs. In the realm of local care, "
            "a large number of issues have not yet been addressed. "
            "The nurse provided a description of the existing process."
        )
        revised = editor.rewrite_via_local(
            original, "student", editor.count_words(original), level=10)
        self.assertIn("report highlights", revised)
        self.assertIn("alongside", revised)
        self.assertIn("many issues have still not been addressed", revised)
        self.assertIn("nurse described", revised)
        self.assertTrue(editor._safe_output(original, revised))
        self.assertTrue(editor._local_grammar_ok(original, revised))

    def test_rehumanize_no_more_patterns_reports_truth_not_same_text(self):
        original = "The nurse read the patient's letter carefully."
        request = Handler({
            "text": original, "originalText": original,
            "tone": "student", "level": 10,
            "mode": "again", "attempt": 1
        })
        code, response = editor.handle_public_rewrite(
            request, lambda *args, **kwargs: True)
        self.assertEqual(code, 422)
        self.assertIn("No further safe rewording", response["error"])
        self.assertNotIn("paraphrased", response)

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
