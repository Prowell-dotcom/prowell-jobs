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
        self.assertEqual(store.validate_bundle(data),'2.0.3')
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
                    self.assertIn('confirm-main.js',script['js'])
                else:
                    self.assertEqual(script['js'][0],'scoped-store.js')
                    self.assertIn('auto-accept.js',script['js'])
            self.assertIn('dual_four_',z.read('background.js').decode())
            self.assertIn('dual_good_',z.read('background.js').decode())

    def test_docker_copies_dual_sources(self):
        root=Path(__file__).resolve().parents[1]
        self.assertIn(
            'COPY extension/dual-writers/ ./extension/dual-writers/',
            (root/'Dockerfile').read_text()
        )
