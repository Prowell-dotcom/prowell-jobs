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
            'id="publicParaphraseAgain"',
            'id="publicParaphraseInlineFeedback"',
            'pp-inline-retry',
            'Rehumanize text',
            'id="publicParaphraseTone"',
            'id="publicParaphraseEngine"',
            'id="publicDeepRewriteStatus"',
            'value="deep" disabled',
            'DeepRewrite',
            'Fast editing',

            'id="publicParaphraseProtectedTerms"',
            'id="publicParaphraseStatus"',
            'href="#paraphraser"',
            'id="prowell-humanizer-inline"',
            'novalidate onsubmit="return false;"',
            'public-paraphraser.css?v=material-edit-v8',
            'No login required',
            'id="publicParaphraseLevel"',
            'id="publicParaphraseLevelValue"',
            'id="publicParaphraseLevelDescription"',
            'min="1" max="10" step="1" value="9"',
        ):
            with self.subTest(required=name):
                self.assertIn(name, markup)
        result_header = markup.index('label for="publicParaphraseOutput"')
        retry_button = markup.index('id="publicParaphraseAgain"')
        result_textarea = markup.index('id="publicParaphraseOutput"')
        self.assertTrue(result_header < retry_button < result_textarea)
        self.assertEqual(markup.count('id="publicParaphraseAgain"'), 1)
        self.assertIn("immediateStatus.textContent=message", markup)
        self.assertIn('Natural student voice', markup)
        self.assertIn('sessionStorage.setItem', markup)
        self.assertIn('retry.addEventListener', markup)
        self.assertIn("mode:again?'again':'first'", markup)
        self.assertIn('originalText:baseline', markup)
        self.assertIn('The original passage stays unchanged', markup)
        self.assertIn('level:Number(depth.value)', markup)
        self.assertIn('Paraphrasing depth', markup)
        self.assertIn('Maximum safe rewrite', markup)
        self.assertIn('sessionStorage.getItem', markup)
        self.assertNotIn('src="public-paraphraser.js', markup)
        self.assertIn("fetch('/api/paraphrase'", markup)
        self.assertIn("fetch('/api/paraphrase/capabilities'", markup)
        self.assertIn("engine:engine.value", markup)
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
        self.assertIn("if path == '/api/paraphrase/capabilities':", source)
        docker_deep = (ROOT / 'prowell_deeprewrite.py').read_text(encoding='utf-8')
        self.assertIn("prowell_deeprewrite.py", docker)
        self.assertIn("def rewrite(", docker_deep)
        self.assertIn("handle_public_rewrite(self, check_rate)", source)
        self.assertNotIn("if path == '/api/admin/paraphrase':", source)
        self.assertIn('public-paraphraser.css', docker)
        self.assertIn('public-paraphraser.js', docker)
        self.assertIn("'/public-paraphraser.css'", source)
        self.assertIn("'/public-paraphraser.js'", source)
        self.assertIn("'Cache-Control','no-store, max-age=0, must-revalidate'", source)
        self.assertIn("fetch('/api/paraphrase'", client)
        self.assertNotIn('/api/admin/paraphrase', client)
        self.assertNotIn('csrfToken', client)
        self.assertNotIn('signedIn', client)


if __name__ == '__main__':
    unittest.main()
