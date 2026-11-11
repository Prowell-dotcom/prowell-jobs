"""Dual-platform ZIP is ready for administrator-only delivery."""
import io
import json
import unittest
import zipfile
from pathlib import Path
import admin_extension_store as store

class DualWritersBundleTests(unittest.TestCase):
    def test_dual_zip_manifest_and_site_isolation(self):
        root=Path(__file__).resolve().parents[1]
        data=store.dual_writers_bundle(root)
        self.assertLess(len(data),store.MAX_ZIP_BYTES)
        self.assertEqual(store.validate_bundle(data),'2.1.16')
        self.assertNotEqual(data,store.bundled_extension(root))
        self.assertNotEqual(data,store.good_writers_bundle(root))
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(set(z.namelist()),set(store.DUAL_WRITERS_FILES))
            manifest=json.loads(z.read('manifest.json'))
            self.assertEqual(manifest['manifest_version'],3)
            self.assertEqual(len(manifest['content_scripts']),4)
            self.assertIn('https://4writers.net/*',manifest['host_permissions'])
            self.assertIn('https://good-writers.com/*',manifest['host_permissions'])
            for script in manifest['content_scripts']:
                if script.get('world') == 'MAIN':
                    self.assertEqual(len(script['js']),1)
                    self.assertTrue(script['js'][0].endswith('/confirm-main.js'))
                else:
                    self.assertEqual(script['js'][:2],['scoped-store.js','legacy-bridge.js'])
                    self.assertIn('legacy-order-sound.js',script['js'])
                    self.assertEqual(len(script['js']),7 if any(
                        '4writers.net' in host for host in script['matches']) else 6)
                    self.assertTrue(any(name.endswith('/runtime-content.js') for name in script['js']))
                    if any('4writers.net' in host for host in script['matches']):
                        self.assertIn('four-section-refresh.js',script['js'])
                        self.assertIn('four-sections.js',script['js'])
                    else:
                        self.assertTrue(any(name.endswith('/runtime-refresh.js') for name in script['js']))
            self.assertIn('dual_four_',z.read('background.js').decode())
            self.assertIn('dual_good_',z.read('background.js').decode())
            self.assertIn('PROWELL_ORDER_SOUND',z.read('legacy-order-sound.js').decode())
            self.assertNotIn('auto-accept.js',z.namelist())
            self.assertNotIn('content.js',z.namelist())
            self.assertIn('legacy/good/runtime-content.js',z.namelist())
            self.assertIn('legacy/four/runtime-content.js',z.namelist())
            self.assertIn('four-sections.js',z.namelist())
            self.assertIn('four-section-refresh.js',z.namelist())
            self.assertIn('legacy/four/runtime-background.js',z.namelist())
            self.assertIn('legacy/good/runtime-background.js',z.namelist())

    def test_docker_copies_dual_sources(self):
        root=Path(__file__).resolve().parents[1]
        self.assertIn(
            'COPY extension/dual-writers/ ./extension/dual-writers/',
            (root/'Dockerfile').read_text()
        )
