"""End-to-end ingestion with synthetic media; never touches athlete records."""
import argparse
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('video_library',
    Path(__file__).resolve().parents[1] / 'scripts/video_library.py')
library = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(library)


class VideoLibraryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        cls.video = Path(cls.fixture.name) / 'camera.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=size=160x120:rate=60', '-t', '0.5',
                        '-c:v', 'libx264', str(cls.video)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.fixture.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.store = self.root / 'media'
        self.store.mkdir()
        self.source = Path(self.temp.name) / 'IMG_1234.MP4'
        shutil.copyfile(self.video, self.source)
        self.original_hash = library.digest(self.source)
        # Ordinary ingestion tests use a deterministic capacity. The low-space
        # test overrides this independently; host /tmp can be a small mount.
        capacity=shutil.disk_usage(self.store)._replace(free=50*library.GIB)
        space_patch=patch.object(library.shutil,'disk_usage',return_value=capacity)
        space_patch.start()
        self.addCleanup(space_patch.stop)
        self.args = argparse.Namespace(input=self.source, store=self.store,
            date='2026-09-20', athlete='athlete-a', label='20 м, попытка 3', sidecar=[])

    def run_import(self):
        output = io.StringIO()
        with redirect_stdout(output):
            library.import_video(self.args, self.root)
        return json.loads(output.getvalue())

    def run_status(self):
        output = io.StringIO()
        with redirect_stdout(output):
            library.inventory(argparse.Namespace(store=self.store, verify=True), self.root)
        return json.loads(output.getvalue())

    def card(self):
        return next((self.root / 'videos').glob('*.json'))

    def test_verified_copy_sidecar_and_private_metadata(self):
        sidecar = Path(self.temp.name) / 'IMG_1234.AAE'
        sidecar.write_bytes(b'original adjustment data')
        self.args.sidecar = [sidecar]
        result = self.run_import()
        self.assertEqual(result['result'], 'imported')
        item = json.loads(self.card().read_text())
        self.assertEqual(library.digest(self.source), self.original_hash)
        self.assertEqual(library.digest(self.store / item['original']), self.original_hash)
        manifest = json.loads((self.store / item['manifest']).read_text())
        self.assertEqual(manifest['status'], 'complete')
        saved_sidecar = (self.store / item['manifest']).parent / manifest['files'][1]['file']
        self.assertEqual(saved_sidecar.read_bytes(), sidecar.read_bytes())
        self.assertNotIn(str(self.temp.name), self.card().read_text())
        self.assertNotIn('IMG_1234', self.card().read_text())
        self.assertEqual(self.run_status()['videos'][0]['source'], 'verified')
        self.assertEqual(self.run_status()['videos'][0]['review'], 'awaiting_review')

    def test_renamed_duplicate_does_not_create_copy_or_reassign(self):
        first = self.run_import()
        renamed = self.source.with_name('renamed.mp4')
        shutil.copyfile(self.source, renamed)
        self.args.input = renamed
        self.args.athlete = 'athlete-b'
        second = self.run_import()
        self.assertEqual(second['result'], 'duplicate')
        self.assertEqual(second['id'], first['id'])
        self.assertEqual(second['athlete'], 'athlete-a')
        self.assertEqual(len(list((self.store / 'originals').iterdir())), 1)

    def test_missing_and_corrupted_source_are_not_silently_replaced(self):
        self.run_import()
        item = json.loads(self.card().read_text())
        saved = self.store / item['original']
        saved.write_bytes(b'corrupted test copy')
        self.assertEqual(self.run_status()['videos'][0]['source'], 'hash_mismatch')
        with self.assertRaises(ValueError):
            self.run_import()
        saved.unlink()  # Only synthetic copy inside TemporaryDirectory.
        self.assertEqual(self.run_status()['videos'][0]['source'], 'unavailable_in_this_store')
        with self.assertRaises(ValueError):
            self.run_import()
        self.assertEqual(library.digest(self.source), self.original_hash)

    def test_review_requires_existing_file(self):
        self.run_import()
        item = json.loads(self.card().read_text())
        item['review'] = 'reviews/test.md'
        library.write_json(self.card(), item)
        self.assertEqual(self.run_status()['videos'][0]['review'], 'review_file_missing')
        (self.root / 'reviews').mkdir()
        (self.root / item['review']).write_text('Synthetic review, not a training observation.')
        self.assertEqual(self.run_status()['videos'][0]['review'], 'saved')

    def test_low_space_and_wrong_store_refuse_copy(self):
        usage = shutil.disk_usage(self.store)._replace(free=10 * library.GIB)
        with patch.object(library.shutil, 'disk_usage', return_value=usage):
            with self.assertRaises(ValueError):
                self.run_import()
        self.assertFalse((self.store / 'originals').exists())
        self.args.store = self.root / 'disconnected'
        with self.assertRaises(FileNotFoundError):
            self.run_import()
        self.assertFalse(self.args.store.exists())
        self.args.store = self.root
        with self.assertRaises(ValueError):
            self.run_import()
        self.assertEqual(library.digest(self.source), self.original_hash)

    def test_failed_copy_is_unindexed_and_preserves_input(self):
        def corrupt_copy(inp, out, length):
            out.write(b'incomplete')
        with patch.object(library.shutil, 'copyfileobj', side_effect=corrupt_copy):
            with self.assertRaises(ValueError):
                self.run_import()
        self.assertEqual(list((self.root / 'videos').glob('*.json')), [])
        folders = self.run_status()['unindexed_folders']
        self.assertEqual(len(folders), 1)
        manifest = json.loads((self.store / 'originals' / folders[0] / 'manifest.json').read_text())
        self.assertEqual(manifest['status'], 'failed')
        self.assertEqual(library.digest(self.source), self.original_hash)

    def test_external_store_and_path_escape(self):
        self.store = Path(self.temp.name) / 'external-disk'
        self.store.mkdir()
        self.args.store = self.store
        self.run_import()
        self.assertEqual(self.run_status()['videos'][0]['source'], 'verified')
        with self.assertRaises(ValueError):
            library.safe_path(self.store, '../outside')


if __name__ == '__main__':
    unittest.main()
