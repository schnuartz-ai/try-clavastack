#!/usr/bin/env python3
"""Add browser static headers to the live Caddyfile without losing VNC routes."""
from pathlib import Path
import sys

source, target = (Path(arg) for arg in sys.argv[1:3])
text = source.read_text()
anchor = 'try.clavastack.com {\n'
assert text.startswith(anchor) and text.count(anchor) == 1
assert 'handle_path /novnc/*' in text and 'handle @api' in text
headers = '''\t# Isolate only the browser simulator; keep legacy pages untouched.
\t@browserPaths path / /index.html /browser/* /builds/*
\theader @browserPaths {
\t\tCross-Origin-Opener-Policy "same-origin"
\t\tCross-Origin-Embedder-Policy "require-corp"
\t\tCross-Origin-Resource-Policy "same-origin"
\t}

\t@versionedBuild path_regexp versioned ^/builds/.+/micropython\\.(js|wasm|data)$
\theader @versionedBuild Cache-Control "public, max-age=31536000, immutable"
\t@buildManifest path_regexp manifest ^/builds/.+/build-info\\.json$
\theader @buildManifest Cache-Control "no-cache"
\theader /browser/current.json Cache-Control "no-cache"

'''
if 'Cross-Origin-Opener-Policy' not in text:
    text = text.replace(anchor, anchor + headers, 1)
text = text.replace('encode gzip', 'encode zstd gzip')
target.write_text(text)
