"""Prepare a disposable browser build of the pinned Bull Bitcoin source.

The submodule is the source of truth. Platform patches belong in this directory,
never in the submodule. A changed upstream pin must be reviewed explicitly.
"""
from pathlib import Path
import argparse
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / "upstream/bullbitcoin"
STAGE = ROOT / ".browser-work/bull-web"
DEPS = ROOT / '.browser-work/bull-deps'
UPSTREAM_COMMIT = "98eb380f74a507ce1bcb6848bd2d77cf46959f9e"
SOURCE_ENTRIES = ["lib", "assets", "localization", "packages", "features", "tools", "test",
                  "integration_test", "drift_schemas", ".fvmrc", "pubspec.yaml",
                  "pubspec.lock", "l10n.yaml", "build.yaml", "analysis_options.yaml",
                  "makefile", "LICENSE", "AGENTS.md", "ARCHITECTURE.md", "FEATURES.md"]


def prepare():
    actual = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=UPSTREAM, text=True
    ).strip()
    if actual != UPSTREAM_COMMIT:
        raise RuntimeError(f"Bull source pin differs: {actual}")
    roots = {name.split('/')[0] for name in subprocess.check_output(
        ["git", "ls-files"], cwd=UPSTREAM, text=True).splitlines()}
    for name in ["makefile", ".fvmrc", "pubspec.yaml", "pubspec.lock"]:
        if name not in roots:
            raise RuntimeError(f"Required pinned source entry is missing or has different case: {name}")
    STAGE.mkdir(parents=True, exist_ok=True)
    for name in SOURCE_ENTRIES:
        source = UPSTREAM / name
        if not source.exists():
            continue
        target = STAGE / name
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            shutil.copy2(source, target)
    print(f"Prepared original Bull Bitcoin {actual} at {STAGE}")


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    prepare()
