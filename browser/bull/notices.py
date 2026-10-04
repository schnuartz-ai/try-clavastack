"""Carry original license/notice texts with the compiled native dependencies."""
import json
import subprocess
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from prepare import ROOT


def source_notice(package):
    # Some published crates keep their original copyright/license notice in
    # the source header rather than a separate LICENSE file.
    folder=Path(package['manifest_path']).parent
    for name in ['src/lib.rs','lib.rs','src/main.rs','main.rs']:
        path=folder/name
        if not path.exists(): continue
        lines=[]
        for line in path.read_text().splitlines():
            if not line.startswith('//'): break
            lines.append(line.removeprefix('//').lstrip())
        notice='\n'.join(lines)
        if 'Copyright' in notice and ('Permission is hereby granted' in notice or 'Licensed under' in notice):
            return name,notice
    return None


def repository_license(package):
    embedded=source_notice(package)
    if embedded: return 'published crate '+embedded[0],embedded[1]
    folder=Path(package['manifest_path']).parent
    vcs=folder/'.cargo_vcs_info.json'
    if not vcs.exists(): return None
    information=json.loads(vcs.read_text())
    commit=information.get('git',{}).get('sha1','')
    repository=package.get('repository') or ('https://github.com/Blockstream/lwk' if package['name'].startswith('lwk_') else '')
    match=re.match(r'https://github.com/([^/]+/[^/#]+)',repository)
    if not match or not re.fullmatch(r'[a-f0-9]{40}',commit): return None
    repo=match[1].removesuffix('.git')
    names=['LICENSE-MIT','LICENSE','LICENSE.md','COPYING','LICENSE-APACHE','LICENSES/MIT.txt']
    if package.get('license')=='CC0-1.0': names=['COPYING','LICENSE','LICENSE.md']
    subfolder=information.get('path_in_vcs','').strip('/')
    if subfolder: names=[f'{subfolder}/{name}' for name in names]+names
    cache=ROOT/'.browser-work/bull-license-cache'/commit
    cache.mkdir(parents=True,exist_ok=True)
    for name in names:
        url=f'https://raw.githubusercontent.com/{repo}/{commit}/{name}'
        target=cache/name
        try:
            if not target.exists():
                target.parent.mkdir(parents=True,exist_ok=True)
                with urllib.request.urlopen(url,timeout=15) as response:
                    text=response.read().decode('utf-8')
                if len(text)<200: continue
                target.write_text(text,encoding='utf-8')
            return url,target.read_text(encoding='utf-8')
        except (OSError,UnicodeError): continue
    return None


def native_notices(output):
    packages = {}
    for library in ['bdk', 'lwk']:
        manifest=ROOT/'.browser-work'/f'{library}-web-rust/Cargo.toml'
        metadata=json.loads(subprocess.check_output([
            'cargo','metadata','--locked','--filter-platform','wasm32-unknown-unknown',
            '--format-version','1','--manifest-path',str(manifest)],text=True,cwd=ROOT))
        for package in metadata['packages']:
            packages[package['id']]=package
    candidates=[package for package in packages.values() if package.get('license') and not
                any(path.is_file() and path.name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE'))
                    for path in Path(package['manifest_path']).parent.iterdir())]
    with ThreadPoolExecutor(max_workers=4) as pool:
        fetched=dict(zip((package['id'] for package in candidates),pool.map(repository_license,candidates)))
    sections=[]
    missing=[]
    for package in sorted(packages.values(),key=lambda item:(item['name'],item['version'])):
        folder=Path(package['manifest_path']).parent
        texts=[path for path in folder.iterdir() if path.is_file() and
               path.name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE'))]
        if package.get('license_file'):
            texts.append(folder/package['license_file'])
        sections.append(f"{package['name']} {package['version']}\n"
                        f"License: {package.get('license') or 'See original license text'}\n"
                        f"Source: {package.get('repository') or package.get('source') or 'browser/bull/'}\n")
        for path in sorted(set(texts)):
            sections.append(f'--- {path.name} ---\n'+path.read_text(errors='replace'))
        if package.get('license') and not texts:
            original=fetched.get(package['id'])
            if original: sections.append(f'--- Original repository license: {original[0]} ---\n'+original[1])
            else: missing.append(f"{package['name']} {package['version']} ({package['license']})")
    for folder in ['bdk-ffi','bdk-dart','lwk-dart']:
        for path in sorted((ROOT/'.browser-work'/folder).glob('LICENSE*')):
            sections.append(f'--- {folder}/{path.name} ---\n'+path.read_text())
    for path in sorted((ROOT/'node_modules/jsqr').glob('LICENSE*')):
        sections.append(f'--- jsQR/{path.name} ---\n'+path.read_text())
    (output/'RUST-NOTICES.txt').write_text('\n\n'.join(sections)+'\n',encoding='utf-8')
    if missing: print('Crates without bundled license files:', ', '.join(missing),flush=True)
    return len(packages)
