"""Verify independent Chrome extensions can coexist without changing 4writers."""
import io
import json
import unittest
import zipfile
from pathlib import Path
import admin_extension_store as store

class GoodWritersPackageTests(unittest.TestCase):
    def test_distinct_packages(self):
        root=Path(__file__).resolve().parents[1]
        good=store.good_writers_bundle(root)
        original=store.bundled_extension(root)
        self.assertNotEqual(good,original)
        self.assertEqual(store.validate_bundle(good),'1.0.0')
        self.assertEqual(store.validate_bundle(original),'0.5.1')
        with zipfile.ZipFile(io.BytesIO(good)) as pkg:
            manifest=json.loads(pkg.read('manifest.json'))
            self.assertIn('Good-Writers',manifest['name'])
            self.assertEqual(manifest['manifest_version'],3)
            self.assertIn('https://good-writers.com/*',manifest['host_permissions'])
            self.assertNotIn('https://4writers.net/*',manifest['host_permissions'])
            self.assertTrue({'manifest.json','background.js','content.js','refresh.js',
                             'popup.html','popup.js','popup-refresh.js'} <= set(pkg.namelist()))
        with zipfile.ZipFile(io.BytesIO(original)) as pkg:
            manifest=json.loads(pkg.read('manifest.json'))
            self.assertIn('4writers.net',manifest['content_scripts'][0]['matches'][0])
    def test_railway_copies_both(self):
        text=(Path(__file__).resolve().parents[1]/'Dockerfile').read_text()
        self.assertIn('COPY extension/good-writers/ ./extension/good-writers/',text)
        self.assertIn('COPY extension/4writers/ ./extension/4writers/',text)
