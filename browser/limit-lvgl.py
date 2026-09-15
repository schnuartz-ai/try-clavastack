#!/usr/bin/env python3
"""Trim optional LVGL sources for the Windows Emscripten browser build."""
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()
old = """ASRCS += $(shell find $(LVGL_PATH)/src -type f -name '*.S')
CSRCS += $(shell find $(LVGL_PATH)/src -type f -name '*.c')
CSRCS += $(shell find $(LVGL_PATH)/demos -type f -name '*.c')
CSRCS += $(shell find $(LVGL_PATH)/examples -type f -name '*.c')"""
new = """# Browser target: software renderer plus SDL; omit optional drivers and
# examples so the emcc command remains below Windows' argument limit.
ASRCS += $(shell find $(LVGL_PATH)/src -type f -name '*.S' | grep -Ev '/(demos|examples|drivers|draw/(nema_gfx|vg_lite|opengles|renesas|nxp))/')
CSRCS += $(shell find $(LVGL_PATH)/src -type f -name '*.c' | grep -Ev '/(demos|examples|drivers|draw/(nema_gfx|vg_lite|opengles|renesas|nxp))/')
# The MockUI user module calls LVGL's first-party SDL v9 drivers directly.
# They live under src/drivers/sdl (not src/draw/sdl) and must be linked.
CSRCS += $(shell find $(LVGL_PATH)/src/drivers/sdl -type f -name '*.c')
CSRCS += $(shell find $(LVGL_PATH)/demos -type f -name '*.c' | grep '/widgets/' | grep -E '/(button|label|textarea|keyboard|checkbox|dropdown|list|menu|msgbox|roller|slider|switch|tabview|tileview|win)/')
CSRCS += $(shell find $(LVGL_PATH)/examples -type f -name '*.c' | grep -E '/(get_started|widgets/(button|label|textarea))/')"""
if old in s:
    p.write_text(s.replace(old, new))
elif "Browser target: software renderer plus SDL" not in s:
    raise SystemExit(f"unexpected LVGL makefile: {p}")
