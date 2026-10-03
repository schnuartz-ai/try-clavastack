#!/usr/bin/env python3
"""Small same-origin HTTP API for the Specter A/B on-demand builder."""

from __future__ import annotations

import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from ab_builds import get_job, pointer_for_job, submit
from electrum_relay import query as electrum_query

LOG = logging.getLogger("specter-ab-api")
MAX_BODY_BYTES = 12_000
MAX_ELECTRUM_BODY_BYTES = 256_000
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        LOG.info("%s - %s", self.address_string(), fmt % args)

    def send_json(self, data: dict, status: int = 200) -> None:
        payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path not in ("/api/ab/build", "/api/ab/electrum"):
            self.send_json({"error": "Not found"}, 404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = MAX_ELECTRUM_BODY_BYTES + 1
        limit = MAX_ELECTRUM_BODY_BYTES if path == "/api/ab/electrum" else MAX_BODY_BYTES
        if size < 0 or size > limit:
            self.send_json({"error": "Request body too large"}, 413)
            return
        try:
            body = json.loads(self.rfile.read(size) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json({"error": "Invalid JSON body"}, 400)
            return
        if not isinstance(body, dict):
            self.send_json({"error": "Expected a JSON object"}, 400)
            return
        if path == "/api/ab/electrum":
            origin = self.headers.get("Origin", "")
            expected = f"https://{self.headers.get('Host', '')}"
            if origin and origin not in (expected, "http://localhost:8765", "http://127.0.0.1:8765", "http://127.0.0.1:8766"):
                self.send_json({"error": "Origin is not allowed"}, 403)
                return
            try:
                self.send_json(electrum_query(body))
            except ValueError as error:
                self.send_json({"error": str(error)}, 400)
            except Exception as error:
                LOG.warning("Electrum request failed: %s", type(error).__name__)
                self.send_json({"error": "Electrum server could not be reached. Please try again."}, 502)
            return
        try:
            job = submit(body.get("url", ""))
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        self.send_json(job, 202)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/ab/health":
            self.send_json({"status": "ok", "electrum": {"tls": True, "servers": ["electrum.blockstream.info", "electrum.emzy.de"]}})
        elif path.startswith("/api/ab/build/"):
            job_id = path.rsplit("/", 1)[-1]
            job = get_job(job_id) if JOB_ID_RE.fullmatch(job_id) else None
            self.send_json(job or {"error": "Unknown build job"}, 200 if job else 404)
        elif path.startswith("/api/ab/pointer/"):
            job_id = path.rsplit("/", 1)[-1]
            pointer = pointer_for_job(job_id) if JOB_ID_RE.fullmatch(job_id) else None
            self.send_json(pointer or {"error": "Build is not ready"}, 200 if pointer else 404)
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_PUT(self) -> None:
        self.send_json({"error": "Method not allowed"}, 405)

    do_DELETE = do_PUT


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    host = os.environ.get("AB_API_HOST", "127.0.0.1")
    port = int(os.environ.get("AB_API_PORT", "9002"))
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    LOG.info("Specter A/B build API listening on %s:%s", host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()
