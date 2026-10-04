"""Check the pinned build manifest without copying or patching app sources."""
import importlib.util
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bull_prepare', ROOT/'browser/bull/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
build_spec = importlib.util.spec_from_file_location('bull_build', ROOT/'browser/build-bull.py')
build = importlib.util.module_from_spec(build_spec)
build_spec.loader.exec_module(build)
package_spec = importlib.util.spec_from_file_location('bull_package', ROOT/'browser/bull/package.py')
package = importlib.util.module_from_spec(package_spec)
package_spec.loader.exec_module(package)


class BullPrepareTest(unittest.TestCase):
    def test_original_makefile_is_copied_with_exact_tracked_case(self):
        work=ROOT/'.browser-work'
        work.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='bull-prepare-check-',dir=work) as folder:
            stage=Path(folder).resolve()
            self.assertTrue(stage.is_relative_to(work.resolve()))
            with patch.object(prepare,'STAGE',stage), patch.object(prepare.shutil,'copytree'):
                prepare.prepare()
            self.assertIn('makefile',prepare.SOURCE_ENTRIES)
            self.assertNotIn('Makefile',prepare.SOURCE_ENTRIES)
            self.assertIn('makefile',[path.name for path in stage.iterdir()])
            self.assertEqual((stage/'makefile').read_bytes(),(prepare.UPSTREAM/'makefile').read_bytes())

    def test_wrong_case_manifest_is_rejected_before_copy(self):
        results=[prepare.UPSTREAM_COMMIT+'\n','Makefile\n.fvmrc\npubspec.yaml\npubspec.lock\n']
        with patch.object(prepare.subprocess,'check_output',side_effect=results), \
             patch.object(prepare.shutil,'copytree') as copying:
            with self.assertRaisesRegex(RuntimeError,'different case: makefile'):
                prepare.prepare()
            copying.assert_not_called()

    def check_flutter_create_preserves_lock(self, fails=False):
        work=ROOT/'.browser-work'
        work.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='bull-lock-check-',dir=work) as folder:
            stage=Path(folder).resolve()
            self.assertTrue(stage.is_relative_to(work.resolve()))
            lock=stage/'pubspec.lock'
            original=(prepare.UPSTREAM/'pubspec.lock').read_bytes()
            lock.write_bytes(original)
            def flutter_create(*args):
                lock.write_text('{"packages":{"flutter":{"version":"0.0.0"}}}')
                if fails: raise RuntimeError('Flutter create failed')
            with patch.object(build,'STAGE',stage), patch.object(build,'run',side_effect=flutter_create) as run:
                if fails:
                    with self.assertRaisesRegex(RuntimeError,'Flutter create failed'):
                        build.create_browser_target('fvm')
                else:
                    build.create_browser_target('fvm')
                run.assert_called_once_with('fvm','flutter','create','--platforms','web','--no-pub','.')
            self.assertEqual(lock.read_bytes(),original)

    def test_flutter_create_keeps_original_lock(self):
        self.check_flutter_create_preserves_lock()

    def test_failed_flutter_create_keeps_original_lock(self):
        self.check_flutter_create_preserves_lock(fails=True)

    def test_qr_bundle_uses_platform_independent_esbuild_api(self):
        work=ROOT/'.browser-work'
        work.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='bull qr bundle check ',dir=work) as folder:
            output=Path(folder).resolve()/'qr_decoder.mjs'
            self.assertTrue(output.is_relative_to(work.resolve()))
            package.bundle_qr(output)
            self.assertGreater(output.stat().st_size,100000)
            subprocess.run(['node','--input-type=module','-e',
                            "const {default:decode}=await import(process.argv[1]); if(typeof decode!=='function'||decode(new Uint8ClampedArray([0,0,0,255]),1,1)!==null) throw new Error('Invalid jsQR bundle')",
                            output.as_uri()],cwd=ROOT,check=True)


if __name__=='__main__': unittest.main()
