"""Regression checks for Humanizer refresh privacy and browser restoration."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HumanizerRefreshTests(unittest.TestCase):
    def test_input_and_result_are_not_saved_for_refresh(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("sessionStorage.removeItem(draftKey)", page)
        self.assertIn("function rememberDraft(){}", page)
        self.assertNotIn("sessionStorage.setItem(draftKey", page)
        self.assertNotIn("function restoreDraft()", page)
        self.assertIn("autocomplete=\"off\"", page)

    def test_separate_live_input_and_output_word_counts(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="publicParaphraseInputWords"', page)
        self.assertIn('id="publicParaphraseOutputWords"', page)
        self.assertIn("inputWords.textContent='Input: '", page)
        self.assertIn("outputWords.textContent='Output: '", page)
        self.assertIn("wordCount(result.value)", page)

    def test_humanize_button_is_beneath_first_box_only(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        input_start = page.index('id="publicParaphraseInput"')
        word_count = page.index('id="publicParaphraseInputWords"')
        action = page.index('id="publicParaphraseSubmit"')
        output_start = page.index('id="publicParaphraseOutput"')
        footer_actions = page.index('<div class="pp-actions">', output_start)
        self.assertTrue(input_start < word_count < action < output_start)
        self.assertLess(action, footer_actions)
        self.assertEqual(page.count('id="publicParaphraseSubmit"'), 1)
        self.assertIn('class="pp-input-actions"', page)
        self.assertIn('.pp-input-actions .pp-submit', page)
        self.assertIn('id="publicParaphraseClear"', page)
        css = (ROOT / "public-paraphraser.css").read_text(encoding="utf-8")
        self.assertIn('.pp-input-actions .pp-submit', css)

    def test_regular_reload_and_history_restore_reset_text(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("window.addEventListener('pageshow',()=>{", page)
        self.assertIn("resetWriting();", page)
        self.assertIn("source.value='';", page)
        self.assertIn("result.value='';", page)
        self.assertIn("originalForResult='';", page)


if __name__ == "__main__":
    unittest.main()
