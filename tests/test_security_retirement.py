"""Regression tests for retirement of the old VNC pool and source pinning."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("source_pins", ROOT / "browser/source_pins.py")
PINS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PINS)


class RetirementTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("bash"), "bash is required")
    def test_retired_shell_entry_points_fail_without_side_effects(self):
        paths = [
            "pool/auto-update.sh", "pool/browser-auto-deploy.sh",
            "pool/healthcheck.sh", "pool/restart-simulator.sh",
            "vps-config/restart-simulator.sh",
        ]
        with tempfile.TemporaryDirectory() as directory:
            for entry in paths:
                for args in ([], ["diy1", "start"], ["diy99", "restart"]):
                    result = subprocess.run(
                        ["bash", str(ROOT / entry), *args], cwd=directory,
                        text=True, capture_output=True, timeout=10,
                    )
                    self.assertNotEqual(result.returncode, 0, (entry, args))
                    self.assertIn("disabled", result.stderr.lower())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_retired_python_entry_points_fail_without_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            for entry in ("pool/server.py", "vps-config/restart-api.py"):
                result = subprocess.run(
                    [sys.executable, str(ROOT / entry)], cwd=directory,
                    text=True, capture_output=True, timeout=10,
                )
                self.assertNotEqual(result.returncode, 0, entry)
                self.assertIn("disabled", result.stderr.lower())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_obsolete_unit_files_are_not_available_for_installation(self):
        for entry in (
            "pool/try-allocator.service", "vps-config/systemd/try-allocator.service",
            "vps-config/systemd/try-auto-update.service", "vps-config/systemd/try-auto-update.timer",
            "vps-config/systemd/try-diy1.service", "vps-config/systemd/try-play1.service",
            "vps-config/systemd/try-schnuartz1.service",
        ):
            self.assertFalse((ROOT / entry).exists(), entry)
        self.assertTrue((ROOT / "vps-config/systemd/try-browser-auto-deploy.service").is_file())
        self.assertTrue((ROOT / "vps-config/systemd/try-ab-builder.service").is_file())

    def test_checked_in_pins_match_checked_in_pointers(self):
        PINS.verify_pointers(PINS.load_pins())

    def test_ci_environment_receives_every_pinned_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "github-env"
            env = {**os.environ, "GITHUB_ENV": str(env_file)}
            result = subprocess.run([sys.executable, str(ROOT / "browser/source_pins.py"), "env"],
                                    env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            actual = dict(line.split("=", 1) for line in env_file.read_text().splitlines())
            expected = {variable: PINS.load_pins()[name] for name, variable in PINS.ENVIRONMENT.items()}
            self.assertEqual(actual, expected)

    def test_invalid_or_missing_source_pins_are_rejected(self):
        pins = PINS.load_pins()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pins.json"
            for invalid in ({}, {**pins, "specter_diy": "main"}, {**pins, "extra": "a" * 40}):
                path.write_text(json.dumps(invalid), encoding="utf-8")
                with self.assertRaises(ValueError):
                    PINS.load_pins(path)

    def test_publication_workflow_uses_pins_and_read_only_build_credentials(self):
        workflow = (ROOT / ".github/workflows/browser.yml").read_text(encoding="utf-8")
        self.assertNotIn("  schedule:", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("python3 browser/source_pins.py env", workflow)
        self.assertIn("python3 browser/source_pins.py verify", workflow)
        for name in ("K9ERT", "FAST", "SCHNUARTZ", "ALTERNATIVE"):
            self.assertIn(f'SOURCE_SHA_OVERRIDE="$PLAYGROUND_{name}_SOURCE_SHA"', workflow)

    def test_mismatched_build_pointer_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            for filename, _ in PINS.POINTERS.values():
                target = temp / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / filename, target)
            target = temp / "browser/specter-desktop-current.json"
            shutil.copyfile(ROOT / "browser/specter-desktop-current.json", target)
            pointer = temp / "browser/current.json"
            data = json.loads(pointer.read_text(encoding="utf-8"))
            data["build"] = "/builds/cryptoadvance/specter-diy/" + "a" * 40 + "/"
            pointer.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                PINS.verify_pointers(PINS.load_pins(), temp)

    @unittest.skipIf(os.name == "nt", "the packaging script requires Linux utilities")
    def test_packaged_site_omits_legacy_vnc_content(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            source = temp / "source"
            (source / "deploy").mkdir(parents=True)
            shutil.copyfile(ROOT / "deploy/package-site.sh", source / "deploy/package-site.sh")

            def write(name, value="fixture"):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value, encoding="utf-8")

            for name in ("index.html", "apple-touch-icon.png", "favicon.ico", "icon-192.png",
                         "icon-512.png", "robots.txt", "sitemap.xml", "site.webmanifest", "llms.txt"):
                write(name)
            for directory_name in ("assets", "bitcoin-keeper", "bull-bitcoin", "blue-wallet", "ab",
                                   "simulators", "sparrow-wallet", "specter-desktop"):
                write(f"{directory_name}/index.html")
            write("simulators/legacy/index.html", "must not be shipped")
            write("novnc/core/rfb.js", "must not be shipped")
            write("pool/server.py", "must not be shipped")
            for number in range(4):
                write(f"builds/fixture-{number}/micropython.wasm")
            for name in ("index.html", "runtime.html", "bridge.js", "LICENSE.txt", "THIRD-PARTY-NOTICES.txt"):
                write(f"blue-wallet/{name}")
            for name in ("bluewallet-app.js", "bluewallet-app.js.LEGAL.txt", "licenses.txt", "fonts.css", "build-info.json"):
                write(f"builds/bluewallet-web/{name}")
            write("assets/bluewallet-logo.png")
            for name in ("site.js", "runtime-worker.js", "current.json", "demo-data.js", "demo-import.js",
                         "companion-media.js", "companion-media.css", "companion-file-dialog.js",
                         "companion-workbench.js", "virtual-host-downloads.js", "specter-desktop-current.json",
                         "runtime/usb-wallet-probe.py", "variants/fixture.json"):
                write(f"browser/{name}")
            env = {**os.environ, "GITHUB_RUN_ID": "123", "GITHUB_SHA": "b" * 40}
            result = subprocess.run(["bash", str(source / "deploy/package-site.sh"), str(temp / "dist")],
                                    env=env, text=True, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            with tarfile.open(temp / "dist/site-release-123.tar.gz", "r:gz") as archive:
                names = {name.removeprefix("./") for name in archive.getnames()}
            self.assertIn("index.html", names)
            self.assertIn("simulators/index.html", names)
            for name in names:
                self.assertFalse(name.startswith(("simulators/legacy/", "novnc/", "pool/")), name)


class FakeAB(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"isolated ab api")

    def log_message(self, *args):
        pass


@unittest.skipUnless(os.environ.get("CADDY_BINARY"), "set CADDY_BINARY to exercise Caddy routes")
class CaddyRouteTests(unittest.TestCase):
    def test_retired_routes_are_denied_even_when_files_exist(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            webroot = temp / "site"
            for name in ("index.html", "api/status", "novnc/core/rfb.js", "diy/sim/1/ws", "simulators/legacy/index.html"):
                file = webroot / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("must not be exposed" if name != "index.html" else "browser site")
            upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeAB)
            threading.Thread(target=upstream.serve_forever, daemon=True).start()
            with socket.socket() as free_socket:
                free_socket.bind(("127.0.0.1", 0))
                port = free_socket.getsockname()[1]
            config = (ROOT / "vps-config/Caddyfile").read_text(encoding="utf-8")
            config = config.replace("try.clavastack.com {", f"http://127.0.0.1:{port} {{", 1)
            config = config.replace("root * /var/www/try-clavastack-deploy/current", f'root * "{webroot}"')
            config = config.replace("127.0.0.1:9002", f"127.0.0.1:{upstream.server_port}")
            config = "{\n admin off\n}\n" + config
            config_file = temp / "Caddyfile"
            config_file.write_text(config, encoding="utf-8")
            env = {**os.environ, "XDG_DATA_HOME": str(temp), "XDG_CONFIG_HOME": str(temp)}
            process = subprocess.Popen([os.environ["CADDY_BINARY"], "run", "--config", str(config_file)],
                                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            base = f"http://127.0.0.1:{port}"
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        self.fail("Caddy failed to start: " + process.stderr.read())
                    try:
                        with urlopen(base + "/", timeout=1) as response:
                            self.assertEqual(response.read(), b"browser site")
                        break
                    except OSError:
                        time.sleep(.05)
                else:
                    self.fail("Caddy did not start")
                for route in ("/api/status", "/api/allocate", "/api/release", "/api/heartbeat",
                              "/diy/sim/1/ws", "/play/sim/1/ws", "/schnuartz/sim/1/ws",
                              "/restart/sim1", "/simulator-ws", "/playground-ws", "/websockify",
                              "/novnc/core/rfb.js", "/simulators/legacy/index.html"):
                    for method in ("GET", "POST"):
                        with self.assertRaises(HTTPError) as error:
                            urlopen(Request(base + route, method=method), timeout=3)
                        self.assertEqual(error.exception.code, 410, (route, method))
                with urlopen(base + "/api/ab/health", timeout=3) as response:
                    self.assertEqual(response.read(), b"isolated ab api")
            finally:
                process.terminate()
                process.wait(timeout=10)
                if process.stderr:
                    process.stderr.close()
                upstream.shutdown()
                upstream.server_close()


if __name__ == "__main__":
    unittest.main()
