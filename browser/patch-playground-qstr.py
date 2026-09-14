#!/usr/bin/env python3
"""Keep the vendored LVGL 9 qstr source list out of the shell argument vector."""

from pathlib import Path
import sys

target = Path(sys.argv[1]) / "py/mkrules.mk"
source = target.read_text()
old = '$(Q)printf "%s\\n" $^ > $@'
new = '$(Q)$(file >$@)$(foreach source,$^,$(file >>$@,$(source)))true'
if source.count(old) == 1:
    target.write_text(source.replace(old, new, 1))
elif new not in source:
    raise RuntimeError(f"Unexpected qstr source rule in {target}")
