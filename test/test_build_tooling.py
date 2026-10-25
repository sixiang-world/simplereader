"""Build commands must not publish, mutate release metadata, or hide failure."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

spec = importlib.util.spec_from_file_location('reader_build', Path(__file__).parents[1] / 'build-tools/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildSafetyTests(unittest.TestCase):
    def test_no_arguments_only_shows_help(self):
        with patch.object(build, 'Builder') as builder, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build.main([]), 0)
            builder.assert_not_called()

    def test_builder_construction_does_not_update_version(self):
        manager = Mock()
        manager.get_version.return_value = '2.3.0'
        manager.validate_version_str.return_value = '2.3.0'
        with patch.object(build, 'VersionManager', return_value=manager), contextlib.redirect_stdout(io.StringIO()):
            build.Builder()
        manager.update_version_in_files.assert_not_called()

    def test_all_target_propagates_docker_failure(self):
        builder = Mock()
        builder.build_docker.return_value = False
        with patch.object(build, 'Builder', return_value=builder):
            self.assertEqual(build.main(['--all']), 1)
        builder.build_extensions.assert_called_once()

    def test_docker_build_is_local_and_failure_is_visible(self):
        builder = build.Builder.__new__(build.Builder)
        builder.version = '2.3.0'
        builder.root_dir = Path('/tmp')
        with patch.object(build.subprocess, 'run') as run:
            self.assertTrue(builder.build_docker())
            args = run.call_args.args[0]
            self.assertEqual(args[:2], ['docker', 'build'])
            self.assertNotIn('--push', args)
            self.assertTrue(run.call_args.kwargs['check'])
        with patch.object(build.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'docker')):
            self.assertFalse(builder.build_docker())

    def test_extensions_preserve_web_dist_and_source_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for browser in build.Builder.BROWSERS:
                folder = root / f'client/manifests/{browser}'
                folder.mkdir(parents=True)
                (folder / 'manifest.json').write_text('{"version":"1.0.0"}')
            for filename in ('index.html', 'version.json', 'help.json'):
                (root / filename).write_text('{}')
            (root / 'dist').mkdir()
            (root / 'dist/index.html').write_text('existing web build')
            builder = build.Builder.__new__(build.Builder)
            builder.root_dir, builder.version = root, '2.3.0'
            builder.build_extensions()
            builder.build_extensions()  # repeatability
            self.assertEqual((root / 'dist/index.html').read_text(), 'existing web build')
            for browser in build.Builder.BROWSERS:
                self.assertEqual(json.loads((root / f'client/manifests/{browser}/manifest.json').read_text())['version'], '1.0.0')
                with zipfile.ZipFile(root / f'dist/extensions/{browser}.zip') as archive:
                    self.assertEqual(json.loads(archive.read('manifest.json'))['version'], '2.3.0')

    def test_archive_failure_propagates(self):
        builder = build.Builder.__new__(build.Builder)
        builder.root_dir = Path('/tmp')
        with patch.object(build, 'make_archive', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                builder._create_extension_zip('Chrome', 'dist/extensions')


if __name__ == '__main__':
    unittest.main()
