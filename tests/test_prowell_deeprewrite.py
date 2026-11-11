"""Prowell DeepRewrite tests: self-hosted-only, candidate quality and API limits."""
import io
import json
import unittest
from unittest.mock import patch

import admin_paraphraser as editor
import prowell_deeprewrite as deep


class FakeHandler:
    def __init__(self,payload):
        self.client_address=("127.0.0.1",1234)
        raw=json.dumps(payload).encode()
        self.headers={"Content-Type":"application/json","Content-Length":str(len(raw))}
        self.rfile=io.BytesIO(raw)
    def send_json(self,status,data):
        return status,data


class DeepRewriteTests(unittest.TestCase):
    def settings(self):
        return patch.dict("os.environ",{
            "PROWELL_DEEPREWRITE_ENABLED":"1",
            "PROWELL_OLLAMA_URL":"http://ollama.railway.internal:11434",
            "PROWELL_OLLAMA_MODEL":"llama3.2:3b",
            "PROWELL_OLLAMA_THREADS":"4",
        })

    def test_disabled_without_explicit_opt_in(self):
        with patch.dict("os.environ",{
                "PROWELL_DEEPREWRITE_ENABLED":"0",
                "PROWELL_OLLAMA_URL":"http://ollama.railway.internal:11434"}):
            self.assertIsNone(deep.model_config())
            self.assertFalse(deep.capabilities()["deepAvailable"])

    def test_accepts_private_hosts_and_refuses_public_urls(self):
        with self.settings():
            self.assertEqual(deep.model_config()[1],"llama3.2:3b")
        for address in (
            "https://ollama.railway.internal:11434",
            "http://example.com:11434",
            "http://127.0.0.2:11434",
            "http://user:secret@ollama.railway.internal:11434",
            "http://ollama.railway.internal:11434/other",
        ):
            with self.subTest(url=address):
                with self.settings(),patch.dict("os.environ",{
                    "PROWELL_OLLAMA_URL":address
                }):
                    self.assertIsNone(deep.model_config())

    def test_second_live_model_semantic_drift_is_rejected(self):
        original = (
            "The clinic contacted patients before scheduled follow-up appointments. "
            "Staff members used reminder calls to confirm appointments and identify "
            "problems with transportation. Nurses recorded the outcomes in the patient records."
        )
        # Observed in the second live production smoke test after tense patch.
        # Plural clinics and confirmation of issues change the original claims.
        bad = (
            "Clinics arrange consultations prior to scheduled follow-up sessions. "
            "Staff members use reminder calls to confirm pertinent issues and "
            "address transportation concerns. Nurses track treatment outcomes "
            "within patients' medical records."
        )
        self.assertFalse(deep._claims_and_tense_preserved(original,bad))
        self.assertIsNone(deep.validate_candidate(original,original,bad,()))

    def test_role_scope_and_appointment_verification_remain_intact(self):
        source = (
            "The clinic contacted patients before scheduled visits. "
            "Nurses used reminder calls to confirm appointments and asked "
            "about transportation problems."
        )
        safe = (
            "Before the scheduled visits, the clinic reached patients by "
            "telephone. Nurses made reminder calls to verify appointments "
            "and discussed transportation problems."
        )
        self.assertTrue(deep._claims_and_tense_preserved(source,safe))
        self.assertIsNotNone(deep.validate_candidate(source,source,safe,()))
        pluralized = safe.replace("the clinic","clinics")
        self.assertFalse(deep._claims_and_tense_preserved(source,pluralized))
        invented = safe.replace("verify appointments","confirm treatment results")
        self.assertFalse(deep._claims_and_tense_preserved(source,invented))

    def test_fidelity_failure_labels_do_not_contain_source_text(self):
        source = (
            "The clinic contacted patients before their visits. "
            "Nurses confirmed appointments and recorded concerns."
        )
        changed = (
            "Clinics report successful treatment results during visits. "
            "Nurses record concerns."
        )
        issue = deep._fidelity_issue(source, changed)
        self.assertIsInstance(issue, str)
        self.assertEqual(issue, "new unsupported outcome or certainty")
        self.assertNotIn("clinic", issue.lower())
        self.assertNotIn("Nurses", issue)
        self.assertEqual(
            deep._fidelity_issue(
                "The clinic contacted patients before their visits. "
                "Nurses confirmed appointments and recorded concerns.",
                "Before their visits, the clinic reached patients. "
                "Nurses verified appointments and documented concerns."
            ), None)

    def test_live_model_hallucinated_results_are_rejected(self):
        original = (
            "The clinic contacted patients before scheduled follow-up appointments. "
            "Staff members used reminder calls to confirm appointments and identify "
            "problems with transportation. Nurses recorded the outcomes in the patient records."
        )
        # Observed from the first production Ollama smoke test, not invented
        # as an artificial grammar error. It changes past tense and fabricates
        # 'successful' outcomes that the original never established.
        incorrect = (
            "The clinic initiates consultations by informing patients of their "
            "upcoming follow-up visits. Staff utilizes reminder notifications for "
            "appointment confirmation and troubleshooting issues related to "
            "transportation. Nurse's detailed records reflect successful outcomes."
        )
        self.assertFalse(deep._claims_and_tense_preserved(original,incorrect))
        self.assertIsNone(deep.validate_candidate(
            original,original,incorrect,()
        ))

    def test_strong_edit_can_keep_actual_claims(self):
        original = (
            "The clinic contacted patients before scheduled follow-up appointments. "
            "Staff members used reminder calls to confirm appointments and identify "
            "problems with transportation. Nurses recorded the outcomes in the patient records."
        )
        correct = (
            "Before their scheduled follow-up visits, the clinic reached patients "
            "using reminder calls. Staff verified appointments and asked about "
            "transportation problems. Nurses documented the results in patient records."
        )
        self.assertTrue(deep._claims_and_tense_preserved(original,correct))
        self.assertIsNotNone(deep.validate_candidate(
            original,original,correct,()
        ))

    def test_time_sequence_and_tense_cannot_be_silently_changed(self):
        base = "Nurses called patients before appointments and recorded their concerns."
        self.assertFalse(deep._claims_and_tense_preserved(
            base,"Nurses call patients and identify their concerns at appointments."
        ))
        self.assertFalse(deep._claims_and_tense_preserved(
            base,"Nurses called patients and documented concerns afterwards."
        ))
        self.assertFalse(deep._claims_and_tense_preserved(
            base,"Nurses reported that every patient was successful before appointments."
        ))

    def test_protected_placeholders_round_trip(self):
        source=('Patients with hypertension took metformin for 25% of '
                'appointments. Fees were $1,200 & staff worked @ clinic '
                'in 2025. The nurse said "Take it as prescribed."')
        hidden, tokens=deep.mask_protected(source)
        self.assertGreater(len(tokens),5)
        self.assertNotIn("$1,200",hidden)
        self.assertNotIn("metformin",hidden)
        self.assertEqual(deep.unmask_candidate(hidden,tokens),source)
        self.assertIsNone(deep.unmask_candidate(hidden.replace(
            next(iter(tokens)),""),tokens))
        self.assertIsNone(deep.unmask_candidate(hidden+next(iter(tokens)),tokens))

    def test_named_people_places_acronyms_are_protected(self):
        text = (
            "The Homeland Threat Assessment from the United States "
            "discusses national coordination with DHS and FEMA."
        )
        hidden, tokens = deep.mask_protected(text)
        self.assertNotIn("Homeland Threat Assessment", hidden)
        self.assertNotIn("United States", hidden)
        self.assertNotIn("DHS", hidden)
        self.assertNotIn("FEMA", hidden)
        self.assertEqual(deep.unmask_candidate(hidden,tokens),text)
        changed=text.replace("United States","United Kingdom")
        self.assertIsNone(deep.validate_candidate(
            text,text,changed,()
        ))

    def test_deep_model_single_concurrent_slot(self):
        source = (
            "The clinic used appointment reminders so that staff "
            "could contact patients before their scheduled visits."
        )
        with self.settings():
            self.assertTrue(deep._MODEL_SLOT.acquire(blocking=False))
            try:
                with self.assertRaisesRegex(
                        deep.DeepRewriteUnavailable, "processing another request"):
                    deep.rewrite(source,source,"student",10)
            finally:
                deep._MODEL_SLOT.release()

    def test_candidate_rejects_changed_figures_and_negation(self):
        original=("The clinic did not contact patients who took metformin "
                  "during 2025 because appointments were cancelled.")
        strong=("During 2025, the clinic did not contact patients taking "
                "metformin after appointments were cancelled.")
        self.assertIsNotNone(deep.validate_candidate(
            original,original,strong,()))
        self.assertIsNone(deep.validate_candidate(
            original,original,strong.replace("2025","2026"),()))
        self.assertIsNone(deep.validate_candidate(
            original,original,strong.replace("did not","did"),()))
        self.assertIsNone(deep.validate_candidate(
            original,original,original,()))

    def test_generate_selects_best_safe_candidate(self):
        original=("The clinic used appointment reminders so that staff "
                  "could contact patients before their scheduled visits.")
        choices=[
            original,
            "Staff contacted patients before their scheduled visits "
            "by using the clinic's appointment reminders.",
            "Staff used the clinic's appointment reminders to reach "
            "patients in advance of their planned visits.",
        ]
        with self.settings():
            with patch.object(deep,"ollama_generate",return_value=choices) as gen:
                out=deep.rewrite(original,original,"student",10)
        self.assertNotEqual(out["paraphrased"],original)
        self.assertGreaterEqual(out["validCandidateCount"],1)
        self.assertEqual(out["candidateCount"],3)
        self.assertTrue(editor._safe_output(original,out["paraphrased"]))
        self.assertFalse(out["trainedNLIUsed"])
        self.assertFalse(out["AlignScoreUsed"])
        self.assertEqual(gen.call_count,1)

    def test_second_generation_repairs_invalid_first_pass(self):
        original = (
            "The clinic contacted patients before their visits. "
            "Nurses confirmed appointments and documented barriers."
        )
        invalid = (
            "Clinics contact patients during their visits. "
            "Nurses document successful treatments."
        )
        valid = (
            "Before their visits, the clinic reached patients. "
            "Nurses verified appointments and recorded barriers."
        )
        calls = []

        def generator(*args, **kwargs):
            calls.append((args, kwargs))
            return [invalid] if len(calls) == 1 else [valid]

        with self.settings():
            with patch.object(deep, "ollama_generate", side_effect=generator):
                out = deep.rewrite(original, original, "student", 9)
        self.assertEqual(out["paraphrased"], valid)
        self.assertEqual(out["candidateCount"], 2)
        self.assertEqual(out["validCandidateCount"], 1)
        self.assertEqual(len(calls), 2)
        self.assertFalse(calls[0][1]["fidelity_retry"])
        self.assertTrue(calls[1][1]["fidelity_retry"])
        self.assertEqual(calls[1][0][8], 101)

    def test_factual_retry_never_bypasses_safety_checks(self):
        original = (
            "The clinic contacted patients before their visits. "
            "Nurses confirmed appointments and documented barriers."
        )
        invalid = (
            "Clinics contact patients during their visits. "
            "Nurses document successful treatments."
        )
        with self.settings():
            with patch.object(deep, "ollama_generate",
                              return_value=[invalid]) as generator:
                with self.assertRaisesRegex(
                        deep.DeepRewriteError, "No generated version"):
                    deep.rewrite(original, original, "student", 10)
        self.assertEqual(generator.call_count, 2)

    def test_rejection_diagnostics_never_log_sensitive_text(self):
        source = (
            "The clinic contacted patients before appointments in 2025. "
            "Nurses recorded follow-up issues after the phone calls."
        )
        invalid = source.replace("2025", "2026")
        reasons = []
        self.assertIsNone(deep.validate_candidate(
            source, source, invalid, (), failures=reasons))
        self.assertEqual(reasons, ["protected details"])
        with self.settings():
            with patch.object(deep, "ollama_generate",
                              return_value=[invalid]):
                with patch("builtins.print") as printer:
                    with self.assertRaises(deep.DeepRewriteError):
                        deep.rewrite(source, source, "student", 9)
        shown = repr(printer.call_args_list)
        self.assertIn("rejection categories", shown)
        self.assertNotIn("2025", shown)
        self.assertNotIn("2026", shown)
        self.assertNotIn("Nurses recorded", shown)

    def test_no_valid_candidate_fails_without_fake_output(self):
        original=("The clinic used appointment reminders so that staff "
                  "could contact patients before scheduled visits in 2025.")
        with self.settings():
            with patch.object(deep,"ollama_generate",return_value=[original,
                  original.replace("2025","2024")]):
                with self.assertRaisesRegex(deep.DeepRewriteError,"No generated version"):
                    deep.rewrite(original,original,"student",10)

    def test_hybrid_preserves_verified_first_draft_on_bad_polish(self):
        original = (
            "The clinic contacted patients before their visits. "
            "Nurses confirmed appointments and documented barriers."
        )
        valid = (
            "Before their visits, the clinic reached patients. "
            "Nurses verified appointments and recorded barriers."
        )
        invalid = (
            "Clinics report successful treatment results during visits. "
            "Nurses record concerns."
        )
        calls = []
        def generator(*args, **kwargs):
            calls.append(args)
            return [valid] if len(calls) == 1 else [invalid]
        with self.settings(), patch.object(
                deep, "ollama_generate", side_effect=generator):
            result = deep.hybrid_rewrite(
                original, original, "student", 9
            )
        self.assertEqual(result["paraphrased"], valid)
        self.assertEqual(result["enginePipeline"], "hybrid")
        self.assertEqual(result["editorialPass"], "retained_verified_draft")
        self.assertEqual(len(calls), 2)

    def test_hybrid_public_endpoint_returns_pipeline_metadata(self):
        source = (
            "The clinic contacted patients before their visits. "
            "Nurses confirmed appointments and documented barriers."
        )
        valid = (
            "Before their visits, the clinic reached patients. "
            "Nurses verified appointments and recorded barriers."
        )
        with self.settings(), patch.object(
                deep, "ollama_generate", return_value=[valid]):
            code, result = editor.handle_public_rewrite(
                FakeHandler({"text":source, "tone":"student",
                             "engine":"hybrid", "level":9}),
                lambda *args, **kwargs:True,
            )
        self.assertEqual(code, 200)
        self.assertEqual(result["engine"], "hybrid")
        self.assertEqual(result["pipeline"], "hybrid")
        self.assertIn("editorialPass", result)

    def test_small_model_first_pass_uses_original_words_not_fragile_tokens(self):
        source = (
            "Nurses contacted patients before appointments in 2025. "
            "They confirmed appointments and documented barriers."
        )
        valid = (
            "Before appointments in 2025, nurses reached patients. "
            "They verified appointments and recorded barriers."
        )
        calls = []
        def generator(*args, **kwargs):
            calls.append(args)
            return [valid]
        with self.settings(), patch.object(
                deep, "ollama_generate", side_effect=generator):
            answer = deep.rewrite(source, source, "student", 9)
        self.assertEqual(answer["paraphrased"], valid)
        self.assertEqual(calls[0][2], source)
        self.assertEqual(calls[0][5], {})
        self.assertEqual(len(calls), 1)

    def test_first_pass_still_rejects_changed_numbers(self):
        source = (
            "Nurses contacted patients before appointments in 2025. "
            "They confirmed appointments and documented barriers."
        )
        false = (
            "Before appointments in 2024, nurses reached patients. "
            "They verified appointments and recorded barriers."
        )
        with self.settings(), patch.object(
                deep, "ollama_generate", return_value=[false]):
            with self.assertRaisesRegex(deep.DeepRewriteError,
                                        "No generated version"):
                deep.rewrite(source, source, "student", 9)

    def test_single_candidate_and_prose_model_response(self):
        sample = "Before their visits, staff contacted patients."
        self.assertEqual(
            deep._parse_candidates('{"rewrite": "' + sample + '"}'),
            [sample],
        )
        self.assertEqual(deep._parse_candidates(sample), [sample])
        self.assertEqual(
            deep._parse_candidates('```json\n{"rewrite": "' + sample + '"}\n```'),
            [sample],
        )
        self.assertEqual(deep._parse_candidates('{"rewrite":'), [])

    def test_compact_model_json_rewrite_variants(self):
        # Small models often return a single rewrite instead of a list.
        for payload in (
            '{"rewrite":"Before their visits, staff contacted patients."}',
            '{"text":"Before their visits, staff contacted patients."}',
            '{"candidates":["Before their visits, staff contacted patients."]}',
            '{"rewrites":[{"text":"Before their visits, staff contacted patients."}]}',
        ):
            self.assertEqual(
                deep._parse_candidates(payload),
                ["Before their visits, staff contacted patients."],
            )
        self.assertEqual(deep._parse_candidates("not JSON"), [])
        self.assertEqual(deep._parse_candidates('{"candidates":null}'), [])

    def test_fast_edit_zero_change_is_not_reported_as_success(self):
        # Even very short passages must not show a completed 0% rewrite.
        source = "The clinic contacted patients."
        with patch.object(editor, "rewrite_via_local", return_value=source):
            code, result = editor.handle_public_rewrite(
                FakeHandler({"text": source, "tone": "student",
                             "engine": "local", "level": 9}),
                lambda *args, **kwargs: True,
            )
        self.assertEqual(code, 422)
        self.assertNotIn("paraphrased", result)
        self.assertEqual(result["editableTextChangePercent"], 0)
        self.assertIn("No meaningful wording change", result["error"])

    def test_public_deep_endpoint_protected_and_rate_limited(self):
        text=("The clinic used appointment reminders so that staff "
              "could contact patients before their scheduled visits.")
        output=("Staff contacted patients before their scheduled visits "
                "by using the clinic's appointment reminders.")
        calls=[]
        data={"text":text,"tone":"student","engine":"deep",
              "level":10,"mode":"first"}
        with self.settings(),patch.object(deep,"ollama_generate",
                                          return_value=[output]):
            code,result=editor.handle_public_rewrite(FakeHandler(data),
                lambda ip,bucket,limit: calls.append((bucket,limit)) or True)
        self.assertEqual(code,200)
        self.assertEqual(result["engine"],"deep")
        self.assertGreaterEqual(result["validCandidateCount"],1)
        self.assertEqual(calls,[
            ("public-paraphrase-local",24),("public-paraphrase-deep",6)
        ])

    def test_no_config_gives_truthful_503_no_copy(self):
        with patch.dict("os.environ",{"PROWELL_DEEPREWRITE_ENABLED":"0"}):
            code,result=editor.handle_public_rewrite(FakeHandler({
                "text":"The nurse read the patient's letter carefully.",
                "tone":"student","engine":"deep","level":10,
            }),lambda *args, **kwargs:True)
        self.assertEqual(code,503)
        self.assertNotIn("paraphrased",result)
        self.assertIn("not yet activated",result["error"])

    def test_deep_350_word_ceiling(self):
        text=("The clinic used appointment reminders so staff contacted patients. "*46)
        with self.settings():
            code,result=editor.handle_public_rewrite(FakeHandler({
                "text":text,"tone":"student","engine":"deep","level":10
            }),lambda *args, **kwargs:True)
        self.assertEqual(code,400)
        self.assertIn("350 words",result["error"])

    def test_rehumanize_history_avoids_duplicate(self):
        source=("The clinic used appointment reminders so that staff "
                "could contact patients before their scheduled visits.")
        first=("Staff contacted patients before their scheduled visits "
               "by using the clinic's appointment reminders.")
        other=("Staff used the clinic's appointment reminders to reach "
               "patients ahead of their planned visits.")
        with self.settings():
            with patch.object(deep,"ollama_generate",return_value=[first,other]):
                answer=deep.rewrite(first,source,"student",10,
                                    history=[first],attempt=1)
        self.assertEqual(answer["paraphrased"],other)

    def test_invalid_history_refused_before_generation(self):
        with self.settings():
            code,result=editor.handle_public_rewrite(FakeHandler({
                "text":"The clinic used reminders before visits.",
                "tone":"student","engine":"deep",
                "history":[5]}),lambda *args, **kwargs:True)
        self.assertEqual(code,400)
        self.assertIn("history",result["error"])

if __name__=="__main__":
    unittest.main()
