"""Tests for private owner paraphrasing; no external API calls or stored text."""
import io
import json
import unittest
from unittest.mock import patch

import admin_paraphraser as tool


class FakeHandler:
    def __init__(self, payload):
        self.allowed=True
        self.csrf=True
        self.client_address=('127.0.0.1',12345)
        self.headers={'Content-Type':'application/json'}
        raw=json.dumps(payload).encode('utf-8')
        self.headers['Content-Length']=str(len(raw))
        self.rfile=io.BytesIO(raw)
        self.results=[]
    def admin_session(self): return {'owner':1} if self.allowed else None
    def admin_write_authorized(self): return self.csrf
    def send_json(self,code,data):
        self.results.append((code,data))
        return (code,data)


class ParaphraserTests(unittest.TestCase):
    def test_word_limits_and_styles(self):
        for text in ['A','hi there','  Singleword  ', 'a '*3000]:
            src, tone, n=tool.validate_request({'text':text,'tone':'natural'})
            self.assertEqual(n,tool.count_words(text))
            self.assertTrue(src)
        with self.assertRaisesRegex(ValueError,'3,000'):
            tool.validate_request({'text':'a '*3001})
        with self.assertRaisesRegex(ValueError,'some text'):
            tool.validate_request({'text':' '})
        with self.assertRaisesRegex(ValueError,'supported'):
            tool.validate_request({'text':'hello','tone':'unknown'})

    def test_admin_only_csrf_and_size_checks(self):
        calls=[]
        rewrite=lambda text,tone,n: calls.append(text) or 'Rewritten content.'
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        handle.allowed=False
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)[0],401)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        handle.csrf=False
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)[0],403)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:False,rewrite)[0],429)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'x '*3001,'tone':'simple'})
        self.assertEqual(tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)[0],400)
        self.assertEqual(calls,[])
        handle=FakeHandler({'text':'Private draft','tone':'simple'})
        code, result=tool.handle_rewrite(handle,lambda *a,**k:True,rewrite)
        self.assertEqual(code,200)
        self.assertEqual(result['outputWords'],2)
        self.assertEqual(result['editingApproach'], 'Natural editorial rewrite with factual safeguards')
        self.assertEqual(calls,['Private draft'])

    def test_api_secret_is_server_side_and_store_disabled(self):
        response={'output':[{'type':'message','content':[{'type':'output_text','text':'A natural rewrite.'}]}]}
        captured=[]
        class FakeResponse:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps(response).encode('utf-8')
        def fake_open(request,timeout):
            captured.append(request)
            return FakeResponse()
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-private-token','PARAPHRASER_MODEL':'gpt-4.1-mini'}):
            with patch('urllib.request.urlopen',side_effect=fake_open):
                out=tool.rewrite_via_openai('Original sentence.','natural',2)
        self.assertEqual(out,'A natural rewrite.')
        payload=json.loads(captured[0].data)
        self.assertFalse(payload['store'])
        self.assertEqual(payload['model'],'gpt-4.1-mini')
        self.assertEqual(captured[0].get_header('Authorization'),'Bearer test-private-token')
        self.assertEqual(len(captured),2)
        self.assertIn('senior copy editor',json.loads(captured[1].data)['instructions'].lower())

    def test_gemini_rewrite_returns_after_one_request_by_default(self):
        calls=[]
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self,*args): return None
            def read(self):
                return json.dumps({"candidates":[{"content":{"parts":[{
                    "text":"A clearer, natural rewrite."}]}}]}).encode("utf-8")
        def fake_open(request, timeout):
            calls.append(request)
            return FakeResponse()
        env={"GEMINI_API_KEY":"test-gemini-key",
             "GEMINI_MODEL":"gemini-3.8-flash",
             "GEMINI_SECOND_PASS":"0",
             "PARAPHRASER_PROVIDER":"gemini"}
        with patch.dict("os.environ",env):
            with patch("urllib.request.urlopen",side_effect=fake_open):
                result=tool.rewrite_via_gemini("Original sentence.", "natural", 2)
        self.assertEqual(result,"A clearer, natural rewrite.")
        self.assertEqual(len(calls),1,"Do not wait for a second request by default")
        self.assertEqual(calls[0].get_header("X-goog-api-key"),"test-gemini-key")

    def test_gemini_second_pass_can_be_enabled(self):
        prompts=[]
        def fake_model(key, model, instructions, prompt):
            prompts.append(prompt)
            return "A better sentence."
        with patch.dict("os.environ",{"GEMINI_API_KEY":"test-key",
            "GEMINI_MODEL":"gemini-3.8-flash","GEMINI_SECOND_PASS":"1"}):
            with patch.object(tool,"_request_gemini",side_effect=fake_model):
                text=tool.rewrite_via_gemini("Original sentence.", "natural", 2)
        self.assertEqual(text,"A better sentence.")
        self.assertEqual(len(prompts),2)

    def test_exact_numbers_symbols_and_medication_names(self):
        source = ("For 2024, patients with hypertension and type 2 diabetes "
                  "used metformin. The medication cost was $1,200, and 25% "
                  "received follow-up advice from nurses & pharmacists @ clinic.")
        rewritten = ("Nurses & pharmacists @ clinic provided follow-up advice "
                     "to 25% of patients in 2024. Patients with hypertension "
                     "and type 2 diabetes used metformin, which cost $1,200.")
        self.assertTrue(tool._safe_output(source, rewritten))
        for changed in (
            rewritten.replace("$1,200", "$1,201"),
            rewritten.replace("25%", "26%"),
            rewritten.replace("&", "and"),
            rewritten.replace("@", "at"),
            rewritten.replace("hypertension", "high blood pressure"),
            rewritten.replace("type 2 diabetes", "diabetes"),
            rewritten.replace("metformin", "insulin"),
        ):
            self.assertFalse(tool._safe_output(source, changed))

    def test_custom_medical_terms_are_exact(self):
        source = ("The patients received mycophenolate mofetil following "
                  "their transplant procedure.")
        exact = tool._validate_protected_terms("mycophenolate mofetil", source)
        rewritten = ("Following transplantation, patients were treated "
                     "with mycophenolate mofetil.")
        self.assertTrue(tool._safe_output(source, rewritten, exact))
        self.assertFalse(tool._safe_output(
            source, rewritten.replace("mycophenolate mofetil",
                                      "another medication"), exact))
        with self.assertRaisesRegex(ValueError, "not found"):
            tool._validate_protected_terms("unrelated medicine", source)

    def test_source_copy_is_retried_and_never_silently_accepted(self):
        source = ("A carefully planned follow-up program helped the clinic "
                  "respond to patients who missed their appointments and "
                  "encouraged nurses to contact them using clear instructions.")
        revised = ("When appointments were missed, clinic nurses contacted "
                   "patients with straightforward guidance. This organized "
                   "follow-up process helped the team respond more effectively.")
        self.assertTrue(tool._too_similar(source, source))
        self.assertFalse(tool._too_similar(source, revised))
        calls = []
        def fake_generation(key, model, instructions, prompt):
            calls.append((instructions, prompt))
            return source if len(calls) == 1 else revised
        output = tool._editorial_rewrite(
            source, "natural", fake_generation, "dummy", "dummy",
            second_pass=False)
        self.assertEqual(output, revised)
        self.assertEqual(len(calls), 2)
        self.assertIn("too close to the source", calls[1][0])
        with self.assertRaisesRegex(RuntimeError, "too close"):
            tool._editorial_rewrite(
                source, "natural",
                lambda *_: source, "dummy", "dummy",
                second_pass=False)

    def test_medical_terms_and_figures_remain_when_glossary_is_used(self):
        source = ("The patients with hypertension took mycophenolate mofetil "
                  "at a cost of $50 per visit, and 10% completed follow-up.")
        protected = tool._validate_protected_terms(
            "mycophenolate mofetil", source)
        draft = ("Among patients with hypertension, 10% completed follow-up. "
                 "Each visit cost $50, and patients took mycophenolate mofetil.")
        calls = []
        def fake_generation(key, model, instructions, prompt):
            calls.append(instructions)
            return draft
        result = tool._editorial_rewrite(
            source, "natural", fake_generation, "dummy", "dummy",
            second_pass=False, protected_terms=protected)
        self.assertEqual(result, draft)
        self.assertIn("mycophenolate mofetil", calls[0])

    def test_student_style_rewrites_formulaic_text_and_preserves_quotation(self):
        self.assertIn("college-student", tool.TONES["student"])
        source = (
            "It is important to note that regular telephone reminders can "
            "help the clinic contact patients about upcoming appointments. "
            "Staff members also explain the schedule and answer questions."
        )
        final = (
            "Clinic staff use regular reminder calls to discuss future "
            "appointments with patients. During the calls, staff can "
            "explain the schedule and respond to questions."
        )
        self.assertTrue(tool._stilted_prose(source))
        self.assertFalse(tool._stilted_prose(final))
        calls = []
        def fake_request(key, model, instructions, prompt):
            calls.append((instructions, prompt))
            return source if len(calls) == 1 else final
        output = tool._editorial_rewrite(
            source, "student", fake_request, "test-key", "test-model",
            second_pass=False)
        self.assertEqual(output, final)
        self.assertEqual(len(calls), 2)
        self.assertIn("college-student", calls[0][0])
        self.assertFalse(tool._too_similar(source, output))
        quoted = ('The student copied the phrase '
                  '"It is important to note that every appointment matters."')
        self.assertFalse(tool._stilted_prose(quoted))

    def test_symbol_order_can_move_but_literals_cannot_change(self):
        source = "The clinic spent $90 and helped 20% of patients & staff @ work."
        output = "At work, staff & patients @ the clinic received help. The clinic spent $90 to reach 20%."
        self.assertTrue(tool._safe_output(source, output))
        self.assertFalse(tool._safe_output(source, output.replace("20%", "20 percent")))
        self.assertFalse(tool._safe_output(source, output.replace("$90", "$91")))

    def test_no_key_fails_cleanly(self):
        with patch.dict('os.environ',{'OPENAI_API_KEY':''}):
            with self.assertRaisesRegex(RuntimeError,'not configured'):
                tool.rewrite_via_openai('Text','natural',1)


if __name__=='__main__':
    unittest.main()
