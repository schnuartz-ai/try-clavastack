#!/usr/bin/env python3
"""Keep the vendored LVGL 9 qstr source list out of the shell argument vector."""

from pathlib import Path
import sys

target = Path(sys.argv[1]) / "py/mkrules.mk"
source = target.read_text()
old = '$(Q)printf "%s\\n" $^ > $@'
new = '$(Q)$(file >$@)$(foreach source,$^,$(file >>$@,$(source)))true'
if source.count(old) == 1:
    source = source.replace(old, new, 1)
elif new not in source:
    raise RuntimeError(f"Unexpected qstr source rule in {target}")

# The full list is already available through sources-file. Passing $? again
# exceeds Linux ARG_MAX on a clean LVGL 9 build; an empty changed_sources set
# makes makeqstrdefs.py process every source from that file.
old = 'sources-file $(HEADER_BUILD)/qstr-sources.txt dependencies $(QSTR_GLOBAL_DEPENDENCIES) changed_sources $?'
new = 'sources-file $(HEADER_BUILD)/qstr-sources.txt dependencies $(QSTR_GLOBAL_DEPENDENCIES) changed_sources'
if source.count(old) == 1:
    source = source.replace(old, new, 1)
elif new not in source:
    raise RuntimeError(f"Unexpected qstr preprocess rule in {target}")
target.write_text(source)
