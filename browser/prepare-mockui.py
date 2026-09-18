#!/usr/bin/env python3
"""Stage the fork's own MockUI entry point with only browser platform seams."""
from pathlib import Path
import sys

source = Path(sys.argv[1]).resolve()
entry = (source / "scenarios/mockui_fw/main.py").read_text()
old_platform = "_ON_HARDWARE = sys.platform not in ('linux', 'darwin')"
old_mount = "os.mount(os.VfsPosix(os.getcwd() + '/build/flash_image'), '/flash')"
for needle in (old_platform, old_mount):
    if entry.count(needle) != 1:
        raise RuntimeError(f"Unexpected MockUI entry point: {needle}")
entry = entry.replace(old_platform, "_ON_HARDWARE = False  # browser has the Unix display driver")
entry = entry.replace(old_mount, "# /flash is preloaded into Emscripten MEMFS by the browser build.")
ready_line = "lv.screen_load(scr)" if "lv.screen_load(scr)" in entry else "scr = SpecterGui(specter_state, ui_state)"
if entry.count(ready_line) != 1:
    raise RuntimeError("Unexpected MockUI screen initialization")
entry = entry.replace(ready_line, ready_line + "\nprint('MOCKUI_READY')")
target = source / "browser_mockui_entry"
target.mkdir(exist_ok=True)
(target / "main.py").write_text(entry)
(source / "browser.manifest.py").write_text("""freeze('f469-disco/usermods/udisplay_f469/display_unixport')
freeze('f469-disco/libs/common')
freeze('f469-disco/micropython/lib/micropython-lib/python-stdlib/base64', 'base64.py')
freeze('f469-disco/micropython/lib/micropython-lib/python-stdlib/contextlib', 'contextlib.py')
freeze('f469-disco/micropython/lib/micropython-lib/micropython/ucontextlib', 'ucontextlib.py')
freeze('scenarios/MockUI/src')
freeze('src', ('app.py', 'config_default.py', 'errors.py', 'helpers.py',
               'platform.py', 'qrencoder.py', 'rng.py', 'specter.py'))
freeze('src', 'apps')
freeze('src', 'gui')
freeze('src', 'hosts')
freeze('src', 'keystore')
freeze('browser_mockui_entry')
""")
