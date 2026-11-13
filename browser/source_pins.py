#!/usr/bin/env python3
"""Load pinned upstream commits and verify the resulting build pointers."""

import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
PIN_FILE = ROOT / "browser/source-pins.json"
ENVIRONMENT = {
    "specter_diy": "SPECTER_SOURCE_SHA",
    "specter_desktop": "SPECTER_DESKTOP_SOURCE_SHA",
    "specter_web_simulator": "SPECTER_WEB_SIMULATOR_SOURCE_SHA",
    "playground_k9ert": "PLAYGROUND_K9ERT_SOURCE_SHA",
    "playground_fast": "PLAYGROUND_FAST_SOURCE_SHA",
    "playground_schnuartz": "PLAYGROUND_SCHNUARTZ_SOURCE_SHA",
    "playground_alternative": "PLAYGROUND_ALTERNATIVE_SOURCE_SHA",
}
POINTERS = {
    "specter_diy": ("browser/current.json", "cryptoadvance/specter-diy"),
    "playground_k9ert": ("browser/variants/specter-playground.json", "k9ert/specter-playground-mockui"),
    "playground_fast": ("browser/variants/specter-playground-fast.json", "schnuartz-ai/specter-playground-mockui"),
    "playground_schnuartz": ("browser/variants/specter-playground-schnuartz.json", "Schnuartz/specter-playground-mockui"),
    "playground_alternative": ("browser/variants/specter-playground-schnuartz-alternative.json", "schnuartz-ai/specter-playground-schnuartz-mockui"),
}


def load_pins(path=PIN_FILE):
    pins = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(pins, dict) or set(pins) != set(ENVIRONMENT):
        raise ValueError("source pin keys do not match the required repositories")
    for name, commit in pins.items():
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError(f"invalid commit pin: {name}")
    return pins


def verify_pointers(pins, root=ROOT):
    for name, (filename, repository) in POINTERS.items():
        data = json.loads((root / filename).read_text(encoding="utf-8"))
        if data.get("build") != f"/builds/{repository}/{pins[name]}/":
            raise ValueError(f"build pointer does not match the configured pin: {name}")
    desktop = json.loads((root / "browser/specter-desktop-current.json").read_text(encoding="utf-8"))
    if (desktop.get("repository") != "cryptoadvance/specter-desktop"
            or desktop.get("commit") != pins["specter_desktop"]
            or desktop.get("diy_repository") != "cryptoadvance/specter-diy"
            or desktop.get("diy_commit") != pins["specter_diy"]
            or desktop.get("web_simulator_repository") != "cryptoadvance/specter-diy-web-simulator"
            or desktop.get("web_simulator_commit") != pins["specter_web_simulator"]):
        raise ValueError("Specter Desktop pointer does not match the configured pins")
    prefix = f"/builds/cryptoadvance/specter-desktop/{pins['specter_desktop']}/"
    if not re.fullmatch(re.escape(prefix) + r"[0-9a-f]{16}/", desktop.get("build", "")):
        raise ValueError("Specter Desktop build path does not match its configured pin")


def main():
    pins = load_pins()
    if sys.argv[1:] == ["env"]:
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
            for name, variable in ENVIRONMENT.items():
                output.write(f"{variable}={pins[name]}\n")
    elif sys.argv[1:] == ["verify"]:
        verify_pointers(pins)
        print("All generated browser pointers match the checked-in source pins.")
    else:
        raise SystemExit("Usage: source_pins.py {env|verify}")


if __name__ == "__main__":
    main()
