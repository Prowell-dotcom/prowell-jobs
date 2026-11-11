"""Protect visibility and session-bound access for the private paraphraser."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class AdminParaphraserVisibilityTests(unittest.TestCase):
    def test_navigation_and_markup(self):
        markup = (ROOT/'admin.html').read_text(encoding='utf-8')
        self.assertIn('id="privateParaphraserPanel"', markup)
        self.assertIn('id="paraphraserShortcut"', markup)
        self.assertIn('href="#privateParaphraserTitle"', markup)
        self.assertIn('admin.js?v=verified-editor-v11', markup)
        self.assertNotIn('<script src="admin-paraphraser.js', markup)
        self.assertIn('id="paraphraseSubmit">', markup)
        self.assertIn('<option value="local" selected>', markup)
        self.assertIn('id="testParaphraserConnection"', markup)

    def test_admin_session_explicit_visibility(self):
        script = (ROOT/'admin.js').read_text(encoding='utf-8')
        self.assertIn("$('#privateParaphraserPanel').hidden=false", script)
        self.assertIn("$('#privateParaphraserPanel').hidden=true", script)
        self.assertIn("window.prowellAdminSignedIn = () => signedIn", script)

    def test_paraphraser_handles_missed_signin_event(self):
        script = (ROOT/'admin.js').read_text(encoding='utf-8')
        self.assertIn('BEGIN PRIVATE PARAPHRASER', script)
        self.assertIn("window.updateProwellParaphraser=sync", script)
        self.assertIn("form.addEventListener('submit'", script)
        self.assertIn("submit.disabled=busy", script)

if __name__=='__main__':
    unittest.main()
