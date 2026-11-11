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

    def test_no_valid_candidate_fails_without_fake_output(self):
        original=("The clinic used appointment reminders so that staff "
                  "could contact patients before scheduled visits in 2025.")
        with self.settings():
            with patch.object(deep,"ollama_generate",return_value=[original,
                  original.replace("2025","2024")]):
                with self.assertRaisesRegex(deep.DeepRewriteError,"No generated version"):
                    deep.rewrite(original,original,"student",10)

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
