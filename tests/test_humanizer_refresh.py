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

    def test_regular_reload_and_history_restore_reset_text(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("window.addEventListener('pageshow',()=>{", page)
        self.assertIn("resetWriting();", page)
        self.assertIn("source.value='';", page)
        self.assertIn("result.value='';", page)
        self.assertIn("originalForResult='';", page)


if __name__ == "__main__":
    unittest.main()
