"""Regression tests for the A/B/companion QR build boundary."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("qr_bridge", HERE / "patch-qr-bridge.py")
qr_bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qr_bridge)

LEGACY = '''class QRCode(Base):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        style = lv.style_t()
        self.task = Task()
    def cb(self, obj, event):
        if event == lv.EVENT.DELETE:
            self.task.cancel()
    def _set_text(self, text):
        print(text)
        self.set_style(qr_style)
        self.rendered = text
'''
GUARDED = LEGACY.replace(
    '        style = lv.style_t()',
    '        self.sensitive = kwargs.get("sensitive", False)\n        style = lv.style_t()',
).replace('        print(text)', '        if not self.sensitive:\n            print(text)')
HELPER = GUARDED.replace(
    '        if not self.sensitive:\n            print(text)\n        self.set_style(qr_style)',
    '        if not self.sensitive:\n            self._report_public_text(text)\n        self.set_style(qr_style)',
) + '    def _report_public_text(self, text):\n        print(text)\n'


class Base:
    def __init__(self, *args, **kwargs):
        pass
    def set_style(self, style):
        pass


class Task:
    cancelled = False
    def cancel(self):
        self.cancelled = True


class BridgeTests(unittest.TestCase):
    def exercise(self, source, sensitive=False, simulator=True):
        updated = qr_bridge.instrument_qr(source)
        self.assertEqual(updated, qr_bridge.instrument_qr(updated))
        env = dict(Base=Base, Task=Task, qr_style=None,
                   platform=SimpleNamespace(simulator=simulator),
                   lv=SimpleNamespace(style_t=lambda: None,
                                      EVENT=SimpleNamespace(DELETE=1)))
        exec(updated, env)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            qr = env["QRCode"](sensitive=sensitive)
            qr._set_text("Text")
            qr._set_text("test-payload")
            qr.cb(None, 1)
        self.assertEqual(qr.rendered, "test-payload")
        self.assertTrue(qr.task.cancelled)
        return output.getvalue().splitlines()

    def test_legacy(self):
        lines = self.exercise(LEGACY)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("SIMULATOR_QR_OUTPUT:"))
        self.assertTrue(lines[0].endswith(":test-payload"))
        self.assertTrue(lines[1].startswith("SIMULATOR_QR_CLEAR:"))

    def test_guarded_and_helper(self):
        for source in (GUARDED, HELPER):
            with self.subTest(source=source):
                self.assertTrue(any(line.endswith(":test-payload")
                                    for line in self.exercise(source)))
                lines = self.exercise(source, sensitive=True)
                self.assertFalse(any("test-payload" in line for line in lines))
                self.assertFalse(any("SIMULATOR_QR_OUTPUT:" in line for line in lines))

    def test_non_simulator(self):
        self.assertEqual(self.exercise(LEGACY, simulator=False), ["Text", "test-payload"])
        self.assertEqual(self.exercise(GUARDED, sensitive=True, simulator=False), [])

    def test_unknown_or_partial_source_fails_closed(self):
        with self.assertRaises(RuntimeError):
            qr_bridge.instrument_qr(LEGACY.replace("print(text)", "log(text)"))
        with self.assertRaises(RuntimeError):
            qr_bridge.instrument_qr(LEGACY + '# SIMULATOR_QR_CLEAR:\n')

    def test_ab_wrapper_disables_bridge(self):
        # Run the real wrapper against a harmless fake compiler entrypoint.
        with tempfile.TemporaryDirectory() as directory:
            browser = Path(directory) / "browser"
            browser.mkdir()
            (browser / "build-ab.sh").write_text((HERE / "build-ab.sh").read_text())
            (browser / "build-browser.sh").write_text(
                'printf "%s\\n" "$BROWSER_QR_BRIDGE" "$SPECTER_SOURCE_SHA"\n')
            sha = "a" * 40
            env = dict(os.environ, BROWSER_QR_BRIDGE="1")
            result = subprocess.check_output(
                ["bash", str(browser / "build-ab.sh"), "owner/specter-diy", sha, "diy"],
                env=env, text=True)
            self.assertEqual(result.splitlines()[:2], ["0", sha])

    def test_main_patcher_no_application_qr_edits(self):
        source = (HERE / "patch-source.py").read_text()
        self.assertNotIn("src/gui/components/qrcode.py", source)
        self.assertNotIn("SIMULATOR_QR_OUTPUT:", source)
        self.assertNotIn("SIMULATOR_QR_CLEAR:", source)
        build = (HERE / "build-browser.sh").read_text()
        self.assertIn('if [[ "$BROWSER_QR_BRIDGE" = 1 ]]; then\n'
                      '  python3 "$ROOT/browser/patch-qr-bridge.py" "$SPECTER_SRC"\nfi', build)


if __name__ == "__main__":
    unittest.main()
