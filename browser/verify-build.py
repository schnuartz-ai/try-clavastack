#!/usr/bin/env python3
"""Verify the static pointer, provenance and generated asset hashes."""
from hashlib import sha256
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parent.parent
for pointer_file, repository in (
    ('current.json', 'Schnuartz/specter-diy'),
    ('variants/specter-playground.json', 'k9ert/specter-playground'),
    ('variants/specter-playground-schnuartz.json', 'schnuartz-ai/specter-playground-schnuartz'),
):
    current = json.loads((root / 'browser' / pointer_file).read_text())
    pointer = current['build']
    assert pointer.startswith('/builds/') and pointer.endswith('/')
    build = root / pointer.lstrip('/')
    manifest = json.loads((build / 'build-info.json').read_text())
    assert manifest['repository'] == repository
    if repository == 'Schnuartz/specter-diy':
        assert re.fullmatch(r'\d+\.\d+\.\d+(?:-rc\d+)?', manifest['firmware_version'])
    else:
        assert manifest['entrypoint'] == 'mockui' and '-mockui/' in pointer
    assert manifest['commit'] in pointer
    assert current['version'] == manifest['artifact_set_sha256'][:16]
    for name, record in manifest['artifacts'].items():
        path = build / name
        assert path.is_file() and path.stat().st_size == record['bytes'], name
        assert sha256(path.read_bytes()).hexdigest() == record['sha256'], name
    print('Verified browser build', repository, manifest['commit'])
