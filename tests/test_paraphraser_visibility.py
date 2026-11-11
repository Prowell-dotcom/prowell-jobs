"""Ensure public paraphraser is visible without login and removed from admin."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PublicParaphraserVisibilityTests(unittest.TestCase):
    def test_homepage_shows_tool_without_account(self):
        markup = (ROOT / 'index.html').read_text(encoding='utf-8')
        for name in (
            'id="paraphraser"',
            'id="publicParaphraseForm"',
            'id="publicParaphraseInput"',
            'id="publicParaphraseOutput"',
            'id="publicParaphraseSubmit"',
            'id="publicParaphraseTone"',
            'id="publicParaphraseProtectedTerms"',
            'id="publicParaphraseStatus"',
            'href="#paraphraser"',
            'public-paraphraser.js?v=public1',
            'public-paraphraser.css?v=public1',
            'No login required',
        ):
            with self.subTest(required=name):
                self.assertIn(name, markup)
        self.assertIn('Natural student voice', markup)
        self.assertNotIn('id="paraphraseEngine"', markup)
        self.assertNotIn('GEMINI_API_KEY', markup)

    def test_admin_dashboard_has_no_paraphraser_ui(self):
        markup = (ROOT / 'admin.html').read_text(encoding='utf-8')
        script = (ROOT / 'admin.js').read_text(encoding='utf-8')
        for removed in ('privateParaphraserPanel', 'paraphraserShortcut',
                        'id="paraphraseForm"', 'privateParaphraserTitle'):
            self.assertNotIn(removed, markup)
            self.assertNotIn(removed, script)
        self.assertNotIn('BEGIN PRIVATE PARAPHRASER', script)

    def test_public_route_and_packaged_assets(self):
        source = (ROOT / 'server.py').read_text(encoding='utf-8')
        docker = (ROOT / 'Dockerfile').read_text(encoding='utf-8')
        client = (ROOT / 'public-paraphraser.js').read_text(encoding='utf-8')
        self.assertIn("if path == '/api/paraphrase':", source)
        self.assertIn("handle_public_rewrite(self, check_rate)", source)
        self.assertNotIn("if path == '/api/admin/paraphrase':", source)
        self.assertIn('public-paraphraser.css', docker)
        self.assertIn('public-paraphraser.js', docker)
        self.assertIn("fetch('/api/paraphrase'", client)
        self.assertNotIn('/api/admin/paraphrase', client)
        self.assertNotIn('csrfToken', client)
        self.assertNotIn('signedIn', client)


if __name__ == '__main__':
    unittest.main()
