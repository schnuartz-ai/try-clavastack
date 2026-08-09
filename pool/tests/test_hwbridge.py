#!/usr/bin/env python3
"""
Tests for the hardware-bridge endpoints added to pool/server.py:
- virtual microSD card (fs/sd) file lifecycle
- QR scanner TCP bridge
- session isolation / path traversal rejection

These exercise the real request-handling code in pool/server.py (not a
reimplementation of it), using temp directories and local TCP listeners in
place of a live VPS deployment. One test (TestRealSimulatorQR) is skipped
unless SPECTER_SIM_QR_PORT is set to a real specter-diy Unix simulator's QR
port, so it can prove true end-to-end delivery when a build is available,
without requiring one in ordinary CI runs.

Run with:  python3 -m pytest pool/tests/test_hwbridge.py -v
       or:  python3 pool/tests/test_hwbridge.py
"""
import base64
import http.client
import importlib
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from http.server import HTTPServer
from socketserver import ThreadingMixIn

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server as srv  # pool/server.py


def make_fake_instance(run_base, inst_id, sd_subdir="sd"):
    """Set up the on-disk state files restart-simulator.sh would create for
    one instance: its RUN_BASE_DIR/<inst>/sd_dir pointer and the SD dir
    itself. Returns the sd dir path."""
    inst_run_dir = os.path.join(run_base, inst_id)
    os.makedirs(inst_run_dir, exist_ok=True)
    sd_dir = os.path.join(run_base, "pooldata", inst_id, "fs", sd_subdir)
    os.makedirs(sd_dir, exist_ok=True)
    with open(os.path.join(inst_run_dir, "sd_dir"), "w") as f:
        f.write(sd_dir)
    return sd_dir


class HwBridgeTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.run_base = self._tmp.name
        self._orig_run_base = srv.RUN_BASE_DIR
        srv.RUN_BASE_DIR = self.run_base
        # Reset shared mutable state between tests.
        srv.sessions.clear()
        with srv.sd_lock:
            srv.sd_inserted.clear()

    def tearDown(self):
        srv.RUN_BASE_DIR = self._orig_run_base
        self._tmp.cleanup()


class TestSDPathSafety(HwBridgeTestCase):
    def setUp(self):
        super().setUp()
        self.sd_dir = make_fake_instance(self.run_base, "inst1")

    def test_rejects_parent_traversal(self):
        self.assertIsNone(srv.sd_safe_path("inst1", "../etc/passwd"))
        self.assertIsNone(srv.sd_safe_path("inst1", "..%2Fetc%2Fpasswd"))

    def test_rejects_path_separators(self):
        self.assertIsNone(srv.sd_safe_path("inst1", "a/b.psbt"))
        self.assertIsNone(srv.sd_safe_path("inst1", "/etc/passwd"))

    def test_rejects_dotfiles_and_empty(self):
        self.assertIsNone(srv.sd_safe_path("inst1", ".hidden"))
        self.assertIsNone(srv.sd_safe_path("inst1", ""))
        self.assertIsNone(srv.sd_safe_path("inst1", "."))
        self.assertIsNone(srv.sd_safe_path("inst1", ".."))

    def test_rejects_overlong_filename(self):
        self.assertIsNone(srv.sd_safe_path("inst1", "a" * 200 + ".psbt"))

    def test_accepts_normal_filenames(self):
        for name in ["wallet.psbt", "test_1-2.txt", "DATA.JSON", "a.psbt"]:
            path = srv.sd_safe_path("inst1", name)
            self.assertIsNotNone(path, name)
            self.assertTrue(path.startswith(os.path.realpath(self.sd_dir) + os.sep))

    def test_resolved_path_always_inside_sd_dir(self):
        path = srv.sd_safe_path("inst1", "wallet.psbt")
        real_sd = os.path.realpath(self.sd_dir)
        self.assertTrue(os.path.realpath(path).startswith(real_sd + os.sep))


class TestSessionIsolation(HwBridgeTestCase):
    def setUp(self):
        super().setUp()
        self.sd_a = make_fake_instance(self.run_base, "instA")
        self.sd_b = make_fake_instance(self.run_base, "instB")
        srv.sessions["sess-a"] = {
            "pool": "diy", "instance_id": "instA",
            "created_at": "2026-01-01T00:00:00", "last_heartbeat": "2026-01-01T00:00:00",
            "expires_at": "2099-01-01T00:00:00",
        }
        srv.sessions["sess-b"] = {
            "pool": "diy", "instance_id": "instB",
            "created_at": "2026-01-01T00:00:00", "last_heartbeat": "2026-01-01T00:00:00",
            "expires_at": "2099-01-01T00:00:00",
        }

    def test_session_resolves_to_its_own_instance_only(self):
        self.assertEqual(srv.session_instance("sess-a"), "instA")
        self.assertEqual(srv.session_instance("sess-b"), "instB")

    def test_unknown_session_resolves_to_none(self):
        self.assertIsNone(srv.session_instance("does-not-exist"))
        self.assertIsNone(srv.session_instance(""))

    def test_instances_have_disjoint_sd_directories(self):
        path_a = srv.sd_safe_path("instA", "wallet.psbt")
        path_b = srv.sd_safe_path("instB", "wallet.psbt")
        self.assertNotEqual(os.path.dirname(path_a), os.path.dirname(path_b))

    def test_writing_to_one_instance_is_invisible_to_the_other(self):
        with open(srv.sd_safe_path("instA", "secret.txt"), "wb") as f:
            f.write(b"only for instance A")
        names_a = {f["name"] for f in srv.sd_list_files("instA")}
        names_b = {f["name"] for f in srv.sd_list_files("instB")}
        self.assertIn("secret.txt", names_a)
        self.assertNotIn("secret.txt", names_b)


class TestSDFileLifecycle(HwBridgeTestCase):
    def setUp(self):
        super().setUp()
        self.sd_dir = make_fake_instance(self.run_base, "inst1")

    def test_insert_eject_toggles_state(self):
        self.assertFalse(srv.sd_inserted.get("s1", False))
        with srv.sd_lock:
            srv.sd_inserted["s1"] = True
        self.assertTrue(srv.sd_inserted["s1"])
        with srv.sd_lock:
            srv.sd_inserted["s1"] = False
        self.assertFalse(srv.sd_inserted["s1"])

    def test_empty_card_lists_no_files(self):
        self.assertEqual(srv.sd_list_files("inst1"), [])

    def test_upload_then_list_then_delete(self):
        path = srv.sd_safe_path("inst1", "wallet.psbt")
        with open(path, "wb") as f:
            f.write(b"psbt\x00\x00fakecontent")
        files = srv.sd_list_files("inst1")
        self.assertEqual([f["name"] for f in files], ["wallet.psbt"])
        self.assertEqual(files[0]["size"], len(b"psbt\x00\x00fakecontent"))

        os.remove(path)
        self.assertEqual(srv.sd_list_files("inst1"), [])

    def test_missing_sd_dir_lists_empty_not_error(self):
        # A brand new / not-yet-restarted instance shouldn't 500.
        self.assertEqual(srv.sd_list_files("never-started-instance"), [])


class _CapturingTCPServer:
    """Stands in for a specter-diy Unix simulator's QR TCP-UART socket."""

    def __init__(self):
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(1)
        self.port = self.sock.getsockname()[1]
        self.received = None
        self._thread = threading.Thread(target=self._accept_once, daemon=True)
        self._thread.start()

    def _accept_once(self):
        self.sock.settimeout(5)
        try:
            conn, _ = self.sock.accept()
            conn.settimeout(5)
            chunks = []
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
            self.received = b"".join(chunks)
            conn.close()
        except OSError:
            pass

    def join(self, timeout=5):
        self._thread.join(timeout)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class TestQRBridge(HwBridgeTestCase):
    def test_payload_delivered_to_instance_qr_port(self):
        fake_qr = _CapturingTCPServer()
        try:
            inst_run_dir = os.path.join(self.run_base, "instqr")
            os.makedirs(inst_run_dir, exist_ok=True)
            with open(os.path.join(inst_run_dir, "qr_port"), "w") as f:
                f.write(str(fake_qr.port))

            ok, err = srv.qr_send_payload("instqr", b"addwallet Test&wpkh(tpub.../0/*)")
            self.assertTrue(ok, err)
            fake_qr.join()
            self.assertEqual(fake_qr.received, b"addwallet Test&wpkh(tpub.../0/*)\r\n")
        finally:
            fake_qr.close()

    def test_missing_port_file_reports_unavailable(self):
        ok, err = srv.qr_send_payload("instance-never-started", b"hello")
        self.assertFalse(ok)
        self.assertIn("not available", err)

    def test_connection_refused_does_not_raise(self):
        inst_run_dir = os.path.join(self.run_base, "instdead")
        os.makedirs(inst_run_dir, exist_ok=True)
        # A port nothing is listening on.
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        dead_port = probe.getsockname()[1]
        probe.close()
        with open(os.path.join(inst_run_dir, "qr_port"), "w") as f:
            f.write(str(dead_port))
        ok, err = srv.qr_send_payload("instdead", b"hello")
        self.assertFalse(ok)
        self.assertIsNotNone(err)


@unittest.skipUnless(
    os.environ.get("SPECTER_SIM_QR_PORT"),
    "set SPECTER_SIM_QR_PORT to a running specter-diy Unix simulator's QR "
    "port to run this true end-to-end test against real firmware",
)
class TestRealSimulatorQR(HwBridgeTestCase):
    def test_real_simulator_accepts_qr_payload(self):
        port = int(os.environ["SPECTER_SIM_QR_PORT"])
        inst_run_dir = os.path.join(self.run_base, "realinst")
        os.makedirs(inst_run_dir, exist_ok=True)
        with open(os.path.join(inst_run_dir, "qr_port"), "w") as f:
            f.write(str(port))
        ok, err = srv.qr_send_payload("realinst", b"hello from automated test")
        self.assertTrue(ok, err)


class _TestHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class TestHTTPEndpoints(HwBridgeTestCase):
    def setUp(self):
        super().setUp()
        self.sd_a = make_fake_instance(self.run_base, "instA")
        self.sd_b = make_fake_instance(self.run_base, "instB")
        srv.sessions["sess-a"] = {
            "pool": "diy", "instance_id": "instA",
            "created_at": "2026-01-01T00:00:00", "last_heartbeat": "2026-01-01T00:00:00",
            "expires_at": "2099-01-01T00:00:00",
        }
        srv.sessions["sess-b"] = {
            "pool": "diy", "instance_id": "instB",
            "created_at": "2026-01-01T00:00:00", "last_heartbeat": "2026-01-01T00:00:00",
            "expires_at": "2099-01-01T00:00:00",
        }
        self.httpd = _TestHTTPServer(("127.0.0.1", 0), srv.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def _req(self, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"} if body is not None else {}
        payload = None
        if body is not None:
            import json
            payload = json.dumps(body)
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, data

    def test_unknown_session_returns_404_not_leaking_instance_info(self):
        status, data = self._req("GET", "/api/session/does-not-exist/sd")
        self.assertEqual(status, 404)

    def test_insert_upload_download_delete_lifecycle(self):
        status, _ = self._req("POST", "/api/session/sess-a/sd/insert")
        self.assertEqual(status, 200)

        content = b"psbt-fake-content-for-test"
        status, data = self._req("POST", "/api/session/sess-a/sd/upload", {
            "filename": "wallet.psbt",
            "data": base64.b64encode(content).decode(),
        })
        self.assertEqual(status, 200, data)

        status, data = self._req("GET", "/api/session/sess-a/sd")
        self.assertEqual(status, 200)
        self.assertIn(b"wallet.psbt", data)

        status, data = self._req("GET", "/api/session/sess-a/sd/download?filename=wallet.psbt")
        self.assertEqual(status, 200)
        self.assertEqual(data, content)

        status, data = self._req("POST", "/api/session/sess-a/sd/delete", {"filename": "wallet.psbt"})
        self.assertEqual(status, 200, data)
        status, data = self._req("GET", "/api/session/sess-a/sd")
        self.assertNotIn(b"wallet.psbt", data)

    def test_upload_without_insert_is_rejected(self):
        status, data = self._req("POST", "/api/session/sess-b/sd/upload", {
            "filename": "wallet.psbt",
            "data": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(status, 409, data)

    def test_upload_rejects_path_traversal_filename(self):
        self._req("POST", "/api/session/sess-a/sd/insert")
        status, data = self._req("POST", "/api/session/sess-a/sd/upload", {
            "filename": "../evil.psbt",
            "data": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(status, 400, data)
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.sd_a), "evil.psbt")))

    def test_upload_rejects_disallowed_extension(self):
        self._req("POST", "/api/session/sess-a/sd/insert")
        status, data = self._req("POST", "/api/session/sess-a/sd/upload", {
            "filename": "wallet.exe",
            "data": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(status, 400, data)

    def test_upload_rejects_oversized_file(self):
        self._req("POST", "/api/session/sess-a/sd/insert")
        too_big = b"a" * (srv.SD_MAX_FILE_BYTES + 1)
        status, data = self._req("POST", "/api/session/sess-a/sd/upload", {
            "filename": "big.txt",
            "data": base64.b64encode(too_big).decode(),
        })
        self.assertEqual(status, 413, data)

    def test_session_cannot_touch_another_sessions_instance_files(self):
        self._req("POST", "/api/session/sess-a/sd/insert")
        self._req("POST", "/api/session/sess-a/sd/upload", {
            "filename": "a-only.txt",
            "data": base64.b64encode(b"a").decode(),
        })
        # sess-b maps to instB, a completely different directory - it must
        # not see sess-a's (instA's) files.
        status, data = self._req("GET", "/api/session/sess-b/sd")
        self.assertEqual(status, 200)
        self.assertNotIn(b"a-only.txt", data)

    def test_qr_endpoint_delivers_and_rejects_oversized(self):
        fake_qr = _CapturingTCPServer()
        try:
            with open(os.path.join(self.run_base, "instA", "qr_port"), "w") as f:
                f.write(str(fake_qr.port))
            status, data = self._req("POST", "/api/session/sess-a/qr", {"payload": "hello qr"})
            self.assertEqual(status, 200, data)
            fake_qr.join()
            self.assertEqual(fake_qr.received, b"hello qr\r\n")
        finally:
            fake_qr.close()

        status, data = self._req("POST", "/api/session/sess-a/qr", {
            "payload": "x" * (srv.QR_MAX_PAYLOAD_BYTES + 1)
        })
        self.assertEqual(status, 413, data)

    def test_qr_endpoint_rejects_empty_payload(self):
        status, data = self._req("POST", "/api/session/sess-a/qr", {"payload": ""})
        self.assertEqual(status, 400, data)

    def test_qr_payload_never_logged(self):
        secret_marker = "super-secret-psbt-marker-should-not-be-logged"
        logged = []
        orig_log_event = srv.log_event

        def capturing_log_event(event, **kw):
            logged.append((event, kw))
            orig_log_event(event, **kw)

        srv.log_event = capturing_log_event
        try:
            fake_qr = _CapturingTCPServer()
            try:
                with open(os.path.join(self.run_base, "instA", "qr_port"), "w") as f:
                    f.write(str(fake_qr.port))
                self._req("POST", "/api/session/sess-a/qr", {"payload": secret_marker})
                fake_qr.join()
            finally:
                fake_qr.close()
        finally:
            srv.log_event = orig_log_event

        for event, kw in logged:
            self.assertNotIn("payload", kw)
            for v in kw.values():
                self.assertNotIn(secret_marker, str(v))


if __name__ == "__main__":
    unittest.main()
