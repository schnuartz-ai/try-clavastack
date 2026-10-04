"""Check the pinned build manifest without copying or patching app sources."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bull_prepare', ROOT/'browser/bull/prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


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


if __name__=='__main__': unittest.main()
