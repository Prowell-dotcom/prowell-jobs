"""Regression checks for grammatical quality workflow and exact factual safeguards."""
import unittest
from collections import Counter
from unittest.mock import patch
import admin_paraphraser as editor

class EditorialQualityTests(unittest.TestCase):
    def test_protects_quantities_citations_and_quotes(self):
        source='In 2025, 12% improved (Smith, 2025). The DOI is 10.1234/example. "Important exact quotation from the original source."'
        good='By 2025, 12% showed improvement (Smith, 2025). The DOI remains 10.1234/example. "Important exact quotation from the original source."'
        bad='By 2025, 22% showed improvement (Smith, 2025). The DOI remains 10.1234/example. "Important exact quotation from the original source."'
        self.assertTrue(editor._safe_output(source,good))
        self.assertFalse(editor._safe_output(source,bad))
        self.assertFalse(editor._safe_output(source,good.replace('(Smith, 2025)','')))
        self.assertFalse(editor._safe_output(source,good.replace('10.1234/example','10.1234/different')))
        self.assertFalse(editor._safe_output(source,good.replace('Important exact quotation','Changed exact quotation')))

    def test_polish_pass_used_when_safe(self):
        calls=[]
        def fake_request(key,model,instructions,prompt):
            calls.append((instructions,prompt))
            return 'The study showed 12% improvement in 2025.' if len(calls)==1 else 'In 2025, the study showed an improvement of 12%.'
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-key','PARAPHRASER_MODEL':'gpt-4.1'}),patch.object(editor,'_request_rewrite',side_effect=fake_request):
            result=editor.rewrite_via_openai('The study had an improvement of 12% in 2025.','natural',11)
        self.assertEqual(len(calls),2)
        self.assertEqual(result,'In 2025, the study showed an improvement of 12%.')
        self.assertIn('senior copy editor', calls[1][0].lower())

    def test_polish_factual_error_returns_safe_draft(self):
        calls=[]
        def fake_request(key,model,instructions,prompt):
            calls.append(1)
            return 'About 12% improved in 2025.' if len(calls)==1 else 'About 99% improved in 2025.'
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-key'}),patch.object(editor,'_request_rewrite',side_effect=fake_request):
            result=editor.rewrite_via_openai('In 2025, 12% improved.','simple',5)
        self.assertEqual(result,'About 12% improved in 2025.')

    def test_first_pass_error_repairs_or_fails_safely(self):
        responses=iter(['The change was 66%.','In 2025 the change was 12%.','In 2025 the change was 12%.'])
        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-key'}),patch.object(editor,'_request_rewrite',side_effect=lambda *args:next(responses)):
            output=editor.rewrite_via_openai('The change was 12% in 2025.','academic',7)
        self.assertIn('12%',output)

        with patch.dict('os.environ',{'OPENAI_API_KEY':'test-key'}),patch.object(editor,'_request_rewrite',side_effect=lambda *args:'Wrong: 66%.'):
            with self.assertRaisesRegex(RuntimeError,'No unreliable rewrite'):
                editor.rewrite_via_openai('The change was 12%.','academic',5)

if __name__=='__main__':
    unittest.main()
