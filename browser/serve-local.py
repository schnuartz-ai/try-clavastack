#!/usr/bin/env python3
"""Serve ClavaStack locally with the isolation headers required by browser USB."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8765


class IsolatedStaticHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
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
