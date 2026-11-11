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
            'id="prowell-humanizer-inline"',
            'novalidate onsubmit="return false;"',
            'public-paraphraser.css?v=admin-style-v3',
            'No login required',
        ):
            with self.subTest(required=name):
                self.assertIn(name, markup)
        self.assertIn('Natural student voice', markup)
        self.assertIn('sessionStorage.setItem', markup)
        self.assertIn('sessionStorage.getItem', markup)
        self.assertNotIn('src="public-paraphraser.js', markup)
        self.assertIn("fetch('/api/paraphrase'", markup)
        self.assertIn('Prowell <span>Humanizer.</span>', markup)
        self.assertIn('Humanized result', markup)
        self.assertIn('>Humanize text ', markup)
        self.assertIn('id="prowell-humanizer-critical-styles"', markup)
        self.assertIn('grid-template-columns:minmax(0,1fr) minmax(0,1fr)', markup)
        self.assertIn('min-height:380px', markup)
        self.assertIn('original administrator studio presentation', markup)
        self.assertIn('grid-template-columns:minmax(0,1fr);gap:22px', markup)
        self.assertIn('height:300px', markup)
        self.assertIn('background:#5355e5', markup)
        self.assertIn('border:1px solid #e5ebf7', markup)
        self.assertIn('@media(max-width:680px)', markup)
        self.assertNotIn('Free online <em>paraphraser.</em>', markup)
        self.assertNotIn('>Free paraphraser</a>', markup)
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
