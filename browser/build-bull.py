"""Reproducible original Bull Bitcoin Flutter/Rust browser build.

Requires FVM 4.3.1, Rust 1.98.1 with wasm32-unknown-unknown,
wasm-bindgen-cli 0.2.105, Emscripten 3.1.74 and the root npm lockfile.
The canonical source submodule is never patched.
"""
from pathlib import Path
import argparse
import hashlib
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'browser/bull'))
from prepare import STAGE, UPSTREAM, prepare

PINS = {
    'bull-sdk': ('SatoshiPortal/bull_sdk', '88e05c9e9d2911f3dcd44b449ee97e27c73c1e51'),
    'bdk-dart': ('bitcoindevkit/bdk-dart', 'fbf8952ed7056c9663e4bd47dddc8b4994580532'),
    'bdk-ffi': ('bitcoindevkit/bdk-ffi', '17c48b8b52ba81cdc58531e75ad1165be0cc25d9'),
    'lwk-dart': ('SatoshiPortal/lwk-dart', 'f554c7842f1f4b8e59c72d10a6f0747cb03fa315'),
}

def run(*args, cwd=STAGE, capture=False):
    print('Running', ' '.join(map(str,args)), flush=True)
    result = subprocess.run(list(map(str,args)), cwd=cwd, check=True,
                            text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout if capture else None

def verify_lock():
    def versions(path):
        text = path.read_text()
        return dict(re.findall(r'^  (\w+):\n(?:(?:    .*\n)+?)    version: (.+)$', text, re.M))
    before, after = versions(UPSTREAM/'pubspec.lock'), versions(STAGE/'pubspec.lock')
    # Only the new browser platform and removed native Flutter build-hook
    # package differ. Every original library retains its locked version.
    allowed = {'bull_browser_platform', 'rust_lib_bull_sdk'}
    changed = [name for name in before.keys() | after.keys()
               if name not in allowed and before.get(name) != after.get(name)]
    if changed: raise RuntimeError(f'Original dependency versions changed: {changed}')

def create_browser_target(fvm):
    # Flutter 3.44.9's create command writes a partial SDK lock even with
    # --no-pub. Keep the upstream resolution while adding only its web target.
    lock=STAGE/'pubspec.lock'
    original=lock.read_bytes()
    try:
        run(fvm,'flutter','create','--platforms','web','--no-pub','.')
    finally:
        lock.write_bytes(original)
    # flutter create's sample is not part of Bull's native test suite.
    sample=STAGE/'test/widget_test.dart'
    if not (UPSTREAM/'test/widget_test.dart').exists(): sample.unlink(missing_ok=True)

def format_sources(fvm):
    paths = run('git','ls-files','*.dart',cwd=UPSTREAM,capture=True).splitlines()
    paths = [path for path in paths if (STAGE/path).is_file()
             and not re.search(r'\.(g|freezed|gr|config|mocks|steps)\.dart$|/generated/', path)]
    batch=25 if os.name=='nt' else 75
    for offset in range(0,len(paths),batch):
        run(fvm,'dart','format',*paths[offset:offset+batch])
    for offset in range(0,len(paths),batch):
        run(fvm,'dart','format','--output=none','--set-exit-if-changed',*paths[offset:offset+batch])

def analyze_platform(fvm):
    # Analyze the external platform overlay using the application's exact
    # resolution, without resolving a second set of package versions.
    config_path=STAGE/'.dart_tool/package_config.json'
    config=json.loads(config_path.read_text())
    for package in config['packages']:
        if not package['rootUri'].startswith('file:'):
            package['rootUri']=(config_path.parent/package['rootUri']).resolve().as_uri()
    target=ROOT/'.browser-work/bull-deps/bull_browser_platform/.dart_tool'
    target.mkdir(exist_ok=True)
    (target/'package_config.json').write_text(json.dumps(config))
    run(fvm,'dart','analyze','--fatal-infos','../bull-deps/bull_browser_platform/lib')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reuse',action='store_true',help='Reuse the already prepared local stage')
    parser.add_argument('--acceptance',action='store_true',help='Also build the separate test-only entry point')
    args=parser.parse_args()
    fvm=os.environ.get('BULL_FVM') or shutil.which('fvm')
    if not fvm and os.name=='nt': fvm=str(ROOT/'.browser-work/fvm/fvm/fvm.exe')
    if not fvm: raise RuntimeError('Install FVM 4.3.1 first')
    for folder,(repository,pin) in PINS.items():
        target=ROOT/'.browser-work'/folder
        if not (target/'.git').exists():
            target.mkdir(parents=True,exist_ok=True)
            run('git','init',target,cwd=ROOT)
            run('git','remote','add','origin',f'https://github.com/{repository}.git',cwd=target)
        current=run('git','rev-parse','HEAD',cwd=target,capture=True).strip() if (target/'.git/HEAD').exists() and subprocess.run(['git','rev-parse','--verify','HEAD'],cwd=target,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0 else ''
        if current != pin:
            if run('git','status','--porcelain',cwd=target,capture=True).strip(): raise RuntimeError(f'Dirty source checkout: {folder}')
            run('git','fetch','--depth','1','origin',pin,cwd=target)
            run('git','checkout','--detach',pin,cwd=target)
    if not args.reuse:
        prepare()
        (STAGE/'pubspec_overrides.yaml').unlink(missing_ok=True)
        run(fvm,'use','3.44.9','--force','--skip-pub-get')
        # Use the upstream make targets on Linux; Windows invokes their exact
        # FVM commands because GNU make is not a standard Windows dependency.
        if os.name != 'nt':
            run('make','deps')
            run('make','build-runner')
            run('make','translations')
        else:
            run(fvm,'flutter','pub','get','--enforce-lockfile')
            run(fvm,'dart','tools/prepare_payjoin_dependency.dart')
            run(fvm,'dart','run','build_runner','build','--force-jit','--delete-conflicting-outputs')
            run(fvm,'dart','run','build_runner','build','--force-jit',cwd=STAGE/'packages/bull_payjoin')
            run(fvm,'flutter','gen-l10n')
        create_browser_target(fvm)
        import apply
        apply.apply_dependencies()
        import uniffi_web, prepare_lwk, prepare_sdk, patch_app
        uniffi_web.generate()
        prepare_lwk.generate()
        prepare_sdk.generate()
        patch_app.generate()
        apply.apply_io()
        run(fvm,'flutter','pub','get')
    version=json.loads(run(fvm,'flutter','--version','--machine',capture=True))
    if version['frameworkVersion']!='3.44.9' or version['dartSdkVersion'].split()[0]!='3.12.2': raise RuntimeError('FVM SDK does not match upstream')
    verify_lock()
    format_sources(fvm)
    run(fvm,'flutter','analyze','--no-pub','--fatal-warnings','--fatal-infos')
    analyze_platform(fvm)
    fixes=run(fvm,'dart','fix','--dry-run',capture=True)
    print(fixes)
    if 'Nothing to fix!' not in fixes: raise RuntimeError('dart fix suggests changes')
    suffix='.exe' if os.name=='nt' else ''
    compiler=ROOT/'.browser-work/emsdk/upstream/bin'
    os.environ['CC_wasm32_unknown_unknown']=str(compiler/f'clang{suffix}')
    os.environ['AR_wasm32_unknown_unknown']=str(compiler/f'llvm-ar{suffix}')
    bindgen=os.environ.get('BULL_WASM_BINDGEN') or shutil.which('wasm-bindgen')
    if not bindgen and os.name=='nt': bindgen=str(ROOT/'.browser-work/wasm-bindgen-download/wasm-bindgen-0.2.105-x86_64-pc-windows-msvc/wasm-bindgen.exe')
    if run(bindgen,'--version',cwd=ROOT,capture=True).strip()!='wasm-bindgen 0.2.105': raise RuntimeError('Wrong wasm-bindgen CLI')
    if 'rustc 1.98.1' not in run('rustc','--version',cwd=ROOT,capture=True): raise RuntimeError('Wrong Rust toolchain')
    for name,library in [('bdk','bdkffi'),('lwk','bull_lwk')]:
        source=ROOT/'.browser-work'/f'{name}-web-rust'
        run('cargo','build','--manifest-path',source/'Cargo.toml','--target','wasm32-unknown-unknown','--release','--lib','--locked',cwd=ROOT)
        run(bindgen,source/f'target/wasm32-unknown-unknown/release/{library}.wasm','--target','web','--out-dir',ROOT/'.browser-work'/f'{name}-web-pkg',cwd=ROOT)
    sqlite=STAGE/'web/sqlite3.wasm'
    expected='922a76b182b6af69b030c8e2fdd3283ecc8e827248b20e4b1f3f3db170b52117'
    if not sqlite.exists():
        with urllib.request.urlopen('https://github.com/simolus3/sqlite3.dart/releases/download/sqlite3-2.9.4/sqlite3.wasm') as response: sqlite.write_bytes(response.read())
    if hashlib.sha256(sqlite.read_bytes()).hexdigest()!=expected: raise RuntimeError('SQLite WASM digest differs')
    run(fvm,'dart','compile','js','--packages=.dart_tool/package_config.json','web/drift_worker.dart','-o','web/drift_worker.js')
    for probe in ['bdk','ur','lwk']:
        if (ROOT/f'browser/bull/{probe}_probe.dart').exists():
            run(fvm,'dart','compile','js','--packages=.dart_tool/package_config.json',f'../../browser/bull/{probe}_probe.dart','-o',f'../{probe}-probe.js')
    run(fvm,'flutter','build','web','--release','--no-pub','--pwa-strategy','none','--no-web-resources-cdn','--no-wasm-dry-run','--base-href','/bull-bitcoin/app/')
    importlib.import_module('package').package()
    if args.acceptance:
        run(fvm,'flutter','build','web','--release','--no-pub','--pwa-strategy','none','--no-web-resources-cdn','--no-wasm-dry-run','--base-href','/.browser-work/bull-acceptance-app/','--target','../../browser/bull/acceptance.dart','--output',ROOT/'.browser-work/bull-acceptance-web')
        importlib.import_module('package').package(source=ROOT/'.browser-work/bull-acceptance-web',output=ROOT/'.browser-work/bull-acceptance-app',acceptance=True)

if __name__=='__main__': main()
