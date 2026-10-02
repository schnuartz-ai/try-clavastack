"""Static browser test server with the same isolation headers as production."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import argparse


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8766)
args = parser.parse_args()


class IsolatedHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()


ThreadingHTTPServer(("127.0.0.1", args.port), partial(IsolatedHandler, directory=".")).serve_forever()
