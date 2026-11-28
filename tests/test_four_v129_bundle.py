"""Regression: isolated 4Writers v2.1.29.5 remains separate from dual bot."""
import json
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

import admin_extension_store as bundles


ROOT = Path(__file__).resolve().parents[1]


class FourOnlyLegacyBotTests(unittest.TestCase):
    def test_standalone_zip_contains_only_4writers_hosts(self):
        data = bundles.four_v129_bundle(ROOT)
        self.assertEqual(bundles.validate_bundle(data), '2.1.29.5')
        with zipfile.ZipFile(BytesIO(data)) as zip_file:
            names = zip_file.namelist()
            self.assertEqual(set(names), set(bundles.FOUR_V129_FILES))
            manifest = json.loads(zip_file.read('manifest.json'))
            self.assertEqual(manifest['version'], '2.1.29.5')
            self.assertEqual(manifest['name'], 'Prowell 4Writers Watcher (v2.1.29 Custom)')
            self.assertEqual(len(manifest['content_scripts']), 2)
            self.assertEqual(len(manifest['host_permissions']), 2)
            hosts = ' '.join(manifest['host_permissions'])
            self.assertIn('4writers.net', hosts)
            self.assertNotIn('good-writers.com', hosts)
            self.assertTrue(all('good-writers.com' not in str(s)
                                for s in manifest['content_scripts']))
            popup = zip_file.read('popup.html').decode('utf-8')
            self.assertIn('START WATCH', popup)
            self.assertIn('>STOP<', popup)
            self.assertNotIn('Good-Writers', popup)
            for script in ['four-section-refresh.js',
                           'legacy/four/runtime-content.js',
                           'legacy/four/confirm-main.js']:
                self.assertIn(script, names)
            refresher = zip_file.read('four-section-refresh.js').decode('utf-8')
            self.assertIn('INTERVALS=Object.freeze([\n    30000,7000,24000,3000,18000,11000,', refresher)
            handler = zip_file.read('legacy/four/runtime-content.js').decode('utf-8')
            self.assertIn('scheduleFinalAckClick()', handler)
            self.assertIn('target.click()', handler)
            self.assertIn('pendingAck:null,lastAckOrderId', handler)
            self.assertNotIn('manualAckScroll:handoff', handler)

    def test_dual_extension_is_not_replaced(self):
        original = json.loads((ROOT / 'extension' / 'dual-writers' /
                               'manifest.json').read_text())
        self.assertEqual(original['version'], '2.1.33')
        self.assertIn('good-writers.com', ' '.join(original['host_permissions']))
        page = (ROOT / 'admin.html').read_text()
        backend = (ROOT / 'server.py').read_text()
        self.assertIn('downloadFourV129Extension', page)
        self.assertIn('/api/admin/four-v129/extension/download', backend)


if __name__ == '__main__':
    unittest.main()
