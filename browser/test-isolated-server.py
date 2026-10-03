"""Static browser test server with the same isolation headers as production."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import argparse
import runpy
import ssl
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8766)
parser.add_argument("--cert")
parser.add_argument("--key")
args = parser.parse_args()


IsolatedHandler = runpy.run_path(str(Path(__file__).with_name("serve-local.py")))["IsolatedStaticHandler"]
class BrowserTestServer(ThreadingHTTPServer):
    # Several iframe runtimes fetch their JS, WASM and fonts concurrently.
    # The default backlog of five can refuse those connections on Windows.
    request_queue_size = 128


server = BrowserTestServer(("127.0.0.1", args.port), partial(IsolatedHandler, directory="."))
if args.cert:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.cert, args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
