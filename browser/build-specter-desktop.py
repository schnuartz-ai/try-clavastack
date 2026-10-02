#!/usr/bin/env python3
"""Package the real Specter Desktop Python application for the browser runtime."""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".browser-work" / "specter-desktop"
OUT_ROOT = ROOT / "builds" / "cryptoadvance" / "specter-desktop"
POINTER = ROOT / "browser" / "specter-desktop-current.json"
DESKTOP_REPO = "cryptoadvance/specter-desktop"
DIY_REPO = "cryptoadvance/specter-diy"
WEB_SIMULATOR_REPO = "cryptoadvance/specter-diy-web-simulator"
PYODIDE_VERSION = "0.27.7"
PYODIDE_PYTHON = "3.12.7"
EMBIT_VERSION = "0.6.1"
HWI_VERSION = "3.1.0"


def run(args: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, check=True, text=True, stdout=subprocess.PIPE)
    return result.stdout.strip()


def resolve_head(repository: str, override: str | None = None) -> str:
    if override:
        if len(override) != 40 or any(char not in "0123456789abcdef" for char in override.lower()):
            raise SystemExit(f"Invalid source commit SHA for {repository}: {override}")
        return override.lower()
    remote = f"https://github.com/{repository}.git"
    lines = run(["git", "ls-remote", remote, "HEAD"]).splitlines()
    if not lines:
        raise SystemExit(f"Could not resolve {repository} HEAD")
    commit = lines[0].split()[0]
    if len(commit) != 40:
        raise SystemExit(f"Invalid resolved commit for {repository}: {commit}")
    return commit


def checkout(repository: str, destination: Path, commit: str) -> Path:
    remote = f"https://github.com/{repository}.git"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not (destination / ".git").exists():
        run(["git", "clone", "--filter=blob:none", remote, str(destination)])
    else:
        run(["git", "-C", str(destination), "remote", "set-url", "origin", remote])
    run(["git", "-C", str(destination), "fetch", "--force", "origin", commit])
    run(["git", "-C", str(destination), "checkout", "--force", commit])
    actual = run(["git", "-C", str(destination), "rev-parse", "HEAD"])
    if actual != commit:
        raise SystemExit(f"Expected {repository} at {commit}; got {actual}")
    return destination


def download_embit() -> tuple[bytes, str, dict[str, bytes]]:
    metadata_url = f"https://pypi.org/pypi/embit/{EMBIT_VERSION}/json"
    with urllib.request.urlopen(metadata_url, timeout=30) as response:
        metadata = json.load(response)
    source = next(item for item in metadata["urls"] if item["packagetype"] == "sdist")
    with urllib.request.urlopen(source["url"], timeout=60) as response:
        payload = response.read()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != source["digests"]["sha256"]:
        raise SystemExit("PyPI embit source archive failed its published SHA-256 check")
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        files: dict[str, bytes] = {}
        package_roots = {
            PurePosixPath(member.name).parent
            for member in archive.getmembers()
            if PurePosixPath(member.name).name == "__init__.py"
            and PurePosixPath(member.name).parent.name == "embit"
        }
        if len(package_roots) != 1:
            raise SystemExit(f"Expected one embit package root, found {package_roots}")
        package_root = package_roots.pop()
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if not member.isfile() or package_root not in path.parents:
                continue
            relative = path.relative_to(package_root)
            if "__pycache__" in relative.parts or relative.suffix == ".pyc":
                continue
            extracted = archive.extractfile(member)
            if extracted:
                files[(PurePosixPath("embit") / relative).as_posix()] = extracted.read()
    if "embit/__init__.py" not in files:
        raise SystemExit("The pinned embit package did not contain embit/__init__.py")
    return payload, digest, files


def download_hwi() -> tuple[str, dict[str, bytes]]:
    metadata_url = f"https://pypi.org/pypi/hwi/{HWI_VERSION}/json"
    with urllib.request.urlopen(metadata_url, timeout=30) as response:
        metadata = json.load(response)
    wheel = next(
        item for item in metadata["urls"]
        if item["packagetype"] == "bdist_wheel" and item["filename"].endswith("py3-none-any.whl")
    )
    with urllib.request.urlopen(wheel["url"], timeout=60) as response:
        payload = response.read()
    digest = sha256(payload)
    if digest != wheel["digests"]["sha256"]:
        raise SystemExit("PyPI HWI wheel failed its published SHA-256 check")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        files = {
            PurePosixPath(name).as_posix(): archive.read(name)
            for name in archive.namelist()
            if not name.endswith("/")
            and "__pycache__" not in PurePosixPath(name).parts
            and not name.endswith(".pyc")
        }
    if "hwilib/__init__.py" not in files or not any(
        name.startswith("hwi-3.1.0.dist-info/") for name in files
    ):
        raise SystemExit("The pinned HWI wheel did not contain the upstream hwilib package metadata")
    return digest, files


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def main() -> None:
    desktop_commit = resolve_head(DESKTOP_REPO, os.getenv("SPECTER_DESKTOP_SOURCE_SHA"))
    web_simulator_commit = resolve_head(
        WEB_SIMULATOR_REPO, os.getenv("SPECTER_WEB_SIMULATOR_SOURCE_SHA")
    )
    diy_pointer = json.loads((ROOT / "browser" / "current.json").read_text(encoding="utf-8"))
    diy_build = ROOT / diy_pointer["build"].lstrip("/") / "build-info.json"
    diy_manifest = json.loads(diy_build.read_text(encoding="utf-8"))
    diy_commit = diy_manifest["commit"]
    if diy_manifest.get("repository") != DIY_REPO or desktop_commit == diy_commit:
        raise SystemExit("Current DIY build provenance did not match the expected upstream repository")

    source = checkout(DESKTOP_REPO, WORK / "source", desktop_commit)
    package_root = source / "src" / "cryptoadvance" / "specter"
    if not (package_root / "server.py").is_file() or not (package_root / "templates").is_dir():
        raise SystemExit("The pinned Specter Desktop tree does not contain its real Flask application")
    namespace_init = source / "src" / "cryptoadvance" / "__init__.py"
    embit_payload, embit_sdist_sha, embit_files = download_embit()
    hwi_wheel_sha, hwi_files = download_hwi()

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    destination = OUT_ROOT / desktop_commit
    destination.mkdir(parents=True, exist_ok=True)
    bundle_path = destination / "source.zip"
    source_records: dict[str, dict[str, object]] = {}
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        candidates = [package_root, namespace_init]
        for candidate in candidates:
            if not candidate.exists():
                continue
            if candidate.is_file():
                files = [candidate]
                prefix = candidate.relative_to(source / "src").as_posix()
                for file_path in files:
                    payload = file_path.read_bytes()
                    bundle.writestr(prefix, payload)
                    source_records[prefix] = {"sha256": sha256(payload), "bytes": len(payload)}
                continue
            for file_path in sorted(candidate.rglob("*")):
                if not file_path.is_file() or "__pycache__" in file_path.parts or file_path.suffix == ".pyc":
                    continue
                relative = file_path.relative_to(source / "src").as_posix()
                payload = file_path.read_bytes()
                bundle.writestr(relative, payload)
                source_records[relative] = {"sha256": sha256(payload), "bytes": len(payload)}
        for relative, payload in sorted(embit_files.items()):
            bundle.writestr(relative, payload)
            source_records[relative] = {"sha256": sha256(payload), "bytes": len(payload)}
        for relative, payload in sorted(hwi_files.items()):
            bundle.writestr(relative, payload)
            source_records[relative] = {"sha256": sha256(payload), "bytes": len(payload)}

    archive_bytes = bundle_path.read_bytes()
    build_info = {
        "schema_version": 1,
        "repository": DESKTOP_REPO,
        "commit": desktop_commit,
        "source_url": f"https://github.com/{DESKTOP_REPO}/commit/{desktop_commit}",
        "diy_repository": DIY_REPO,
        "diy_commit": diy_commit,
        "web_simulator_repository": WEB_SIMULATOR_REPO,
        "web_simulator_commit": web_simulator_commit,
        "built_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "runtime": {
            "pyodide": PYODIDE_VERSION,
            "python": PYODIDE_PYTHON,
            "emscripten": diy_manifest.get("emscripten_version", "3.1.74"),
        },
        "python_dependencies": {
            "embit": EMBIT_VERSION,
            "embit_sdist_sha256": embit_sdist_sha,
            "hwi": HWI_VERSION,
            "hwi_wheel_sha256": hwi_wheel_sha,
        },
        "source_archive": {
            "path": "source.zip",
            "sha256": sha256(archive_bytes),
            "bytes": len(archive_bytes),
            "files": source_records,
        },
        "upstream_evidence": {
            "flask_application": "cryptoadvance/specter/server.py",
            "welcome_template": "cryptoadvance/specter/templates/welcome.html",
            "qr_scanner_template": "cryptoadvance/specter/templates/includes/qr-scanner.html",
            "qr_output_template": "cryptoadvance/specter/templates/includes/qr-code.html",
        },
        "browser_adapters": [
            "filesystem: Emscripten IDBFS mounted at /specter-browser-state",
            "process and TCP: disabled in the Worker boundary",
            "USB/HWI/Tor: physical transports report no hardware in browser WASM",
            "QR camera and simulator frame input: upstream scanner parser is retained",
        ],
    }
    (destination / "build-info.json").write_text(
        json.dumps(build_info, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    pointer = {
        "build": f"/builds/{DESKTOP_REPO}/{desktop_commit}/",
        "version": sha256(archive_bytes)[:16],
        "repository": DESKTOP_REPO,
        "commit": desktop_commit,
        "diy_repository": DIY_REPO,
        "diy_commit": diy_commit,
        "web_simulator_repository": WEB_SIMULATOR_REPO,
        "web_simulator_commit": web_simulator_commit,
    }
    POINTER.write_text(json.dumps(pointer, indent=2) + "\n", encoding="utf-8")
    print(f"Specter Desktop browser source: {DESKTOP_REPO}@{desktop_commit}")
    print(f"Source archive: {bundle_path} ({len(archive_bytes):,} bytes)")
    print(f"DIY source: {DIY_REPO}@{diy_commit}")
    print(f"DIY web simulator: {WEB_SIMULATOR_REPO}@{web_simulator_commit}")


if __name__ == "__main__":
    main()
