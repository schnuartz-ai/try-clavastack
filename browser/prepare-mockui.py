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
demo_anchor = "gc.collect()\n\nscr = SpecterGui"
if entry.count(demo_anchor) != 1:
    raise RuntimeError("Unexpected MockUI state initialization")
demo_fixture = r'''# Browser-only fixtures, enabled by the workbench's demo-data button.
try:
    _browser_demo = bool(os.stat('/bridge/demo-mode'))
except OSError:
    _browser_demo = False

if _browser_demo:
    _demo_seed = Seed(label="ClavaStack Demo", fingerprint="73c5da0a")
    _backup_seed = Seed(label="Backup Key", fingerprint="f00dbabe")
    specter_state.add_seed(_demo_seed)
    specter_state.add_seed(_backup_seed)
    _demo_wallets = [
        Wallet(label="Daily Wallet", descriptor="wpkh([73c5da0a/84'/0'/0']xpub...)", required_fingerprints=["73c5da0a"], account=0),
        Wallet(label="Savings", descriptor="wpkh([73c5da0a/84'/0'/1']xpub...)", required_fingerprints=["73c5da0a"], account=1),
        Wallet(label="Legacy Wallet", descriptor="pkh([73c5da0a/44'/0'/0']xpub...)", required_fingerprints=["73c5da0a"], account=0),
        Wallet(label="Taproot", descriptor="tr([73c5da0a/86'/0'/0']xpub...)", required_fingerprints=["73c5da0a"], account=0),
        Wallet(label="2 of 2 Company", descriptor="wsh(multi(2,[73c5da0a]xpub...,[f00dbabe]xpub...))", isMultiSig=True, threshold=2, required_fingerprints=["73c5da0a", "f00dbabe"]),
        Wallet(label="Inheritance", descriptor="fancy script", required_fingerprints=["73c5da0a"]),
    ]
    for _demo_wallet in _demo_wallets:
        specter_state.register_wallet(_demo_wallet, imported=True)
    try:
        specter_state.set_active_seed(_demo_seed)
        specter_state.set_active_wallet(_demo_wallets[0])
    except AttributeError:
        ui_state.set_active_seed(_demo_seed)
        ui_state.set_active_wallet(_demo_wallets[0])

'''
entry = entry.replace(demo_anchor, demo_fixture + demo_anchor)
target = source / "browser_mockui_entry"
target.mkdir(exist_ok=True)
(target / "main.py").write_text(entry)
(source / "browser.manifest.py").write_text("""freeze('f469-disco/usermods/udisplay_f469/display_unixport')
freeze('f469-disco/libs/common')
freeze('scenarios/MockUI/src')
freeze('src', ('rng.py',))
freeze('browser_mockui_entry')
""")
