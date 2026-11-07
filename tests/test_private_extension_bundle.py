"""Check administrator extension download packaging and isolation."""
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import admin_extension_store as store


class PrivateExtensionBundleTests(unittest.TestCase):
    def test_github_source_is_installable(self):
        root = Path(__file__).resolve().parents[1]
        data = store.bundled_extension(root)
        self.assertLess(len(data), store.MAX_ZIP_BYTES)
        self.assertEqual(store.validate_bundle(data), '0.5.2')
        with zipfile.ZipFile(io.BytesIO(data)) as zipped:
            names = set(zipped.namelist())
            self.assertTrue({'manifest.json','content.js','popup.js','popup.html','background.js','refresh.js','popup-refresh.js'} <= names)
            manifest = json.loads(zipped.read('manifest.json'))
            self.assertEqual(manifest['manifest_version'], 3)
            self.assertIn('https://4writers.net/*', manifest['host_permissions'])

    def test_release_is_built_from_repository(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            data, source = store.selected_bundle(Path(tmp) / 'database.sqlite3', root)
        self.assertEqual(source, 'github-bundled')
        self.assertEqual(store.validate_bundle(data), '0.5.2')

    def test_docker_image_includes_source_files(self):
        root = Path(__file__).resolve().parents[1]
        dockerfile = (root / 'Dockerfile').read_text()
        self.assertIn('COPY extension/4writers/ ./extension/4writers/', dockerfile)


if __name__ == '__main__':
    unittest.main()
