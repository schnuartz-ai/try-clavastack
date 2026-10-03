#!/usr/bin/env python3
"""Verify the static pointer, provenance and generated asset hashes."""
from hashlib import sha256
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parent.parent
for pointer_file, repository in (
    ('current.json', 'cryptoadvance/specter-diy'),
    ('variants/specter-playground.json', 'k9ert/specter-playground'),
    ('variants/specter-playground-fast.json', 'schnuartz-ai/specter-playground'),
    ('variants/specter-playground-schnuartz.json', 'Schnuartz/specter-playground'),
    ('variants/specter-playground-schnuartz-alternative.json', 'schnuartz-ai/specter-playground-schnuartz'),
):
    current = json.loads((root / 'browser' / pointer_file).read_text())
    pointer = current['build']
    assert pointer.startswith('/builds/') and pointer.endswith('/')
    build = root / pointer.lstrip('/')
    manifest = json.loads((build / 'build-info.json').read_text())
    assert manifest['repository'] == repository
    if repository in ('cryptoadvance/specter-diy', 'Schnuartz/specter-diy'):
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

desktop_pointer = json.loads((root / 'browser' / 'specter-desktop-current.json').read_text())
assert desktop_pointer['repository'] == 'cryptoadvance/specter-desktop'
assert re.fullmatch(r'[a-f0-9]{40}', desktop_pointer['commit'])
assert re.fullmatch(r'[a-f0-9]{16}', desktop_pointer['version'])
assert desktop_pointer['build'] == (
    f"/builds/{desktop_pointer['repository']}/{desktop_pointer['commit']}/{desktop_pointer['version']}/"
)
desktop_root = root / desktop_pointer['build'].lstrip('/')
desktop_manifest = json.loads((desktop_root / 'build-info.json').read_text())
assert desktop_manifest['repository'] == desktop_pointer['repository']
assert desktop_manifest['commit'] == desktop_pointer['commit']
assert desktop_manifest['diy_repository'] == 'cryptoadvance/specter-diy'
assert desktop_manifest['web_simulator_repository'] == 'cryptoadvance/specter-diy-web-simulator'
archive_record = desktop_manifest['source_archive']
archive_path = desktop_root / archive_record['path']
assert archive_path.is_file() and archive_path.stat().st_size == archive_record['bytes']
archive_bytes = archive_path.read_bytes()
assert sha256(archive_bytes).hexdigest() == archive_record['sha256']
public_derivation = desktop_manifest['public_derivation']
assert public_derivation['package'] == 'tiny-secp256k1' and public_derivation['version'] == '2.2.4'
assert set(public_derivation['files']) == {'secp256k1.js', 'secp256k1.wasm'}
for name, record in public_derivation['files'].items():
    payload = (desktop_root / name).read_bytes()
    assert len(payload) == record['bytes'] and sha256(payload).hexdigest() == record['sha256'], name
assert (desktop_root / 'secp256k1.LICENSE.txt').is_file()
assert sha256(archive_bytes + (desktop_root / 'secp256k1.js').read_bytes()
              + (desktop_root / 'secp256k1.wasm').read_bytes()).hexdigest()[:16] == desktop_pointer['version']
with __import__('zipfile').ZipFile(archive_path) as source_archive:
    names = set(source_archive.namelist())
    assert 'cryptoadvance/specter/server.py' in names
    assert 'cryptoadvance/specter/templates/includes/qr-scanner.html' in names
    assert 'embit/__init__.py' in names
    assert 'hwilib/__init__.py' in names
    assert 'hwi-3.1.0.dist-info/METADATA' in names
    for name, record in archive_record['files'].items():
        payload = source_archive.read(name)
        assert len(payload) == record['bytes'] and sha256(payload).hexdigest() == record['sha256'], name
print('Verified Specter Desktop source archive', desktop_manifest['repository'], desktop_manifest['commit'])
