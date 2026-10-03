#!/usr/bin/env python3
"""Serve ClavaStack locally with the isolation headers required by browser USB."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pool"))
from electrum_relay import query as electrum_query

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8765


class IsolatedStaticHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/ab/electrum":
            self.send_error(404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 256000:
                raise ValueError("Invalid request size")
            result = electrum_query(json.loads(self.rfile.read(size)))
            status = 200
        except Exception as error:
            result, status = {"error": str(error)}, 502
        payload = json.dumps(result).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()


def main():
    handler = lambda *args, **kwargs: IsolatedStaticHandler(  # noqa: E731
        *args, directory=str(ROOT), **kwargs
    )
    server = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"ClavaStack local preview: http://{HOST}:{PORT}/specter-desktop/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
