"""Stage a built original Flutter app with its actual Rust WASM libraries."""
from pathlib import Path
import shutil
import subprocess
import hashlib
import json
from prepare import ROOT, STAGE
from notices import native_notices


def bundle_qr(output):
    # esbuild/bin/esbuild may be a native executable on Unix and a JS wrapper
    # on Windows. Its JavaScript API selects the correct installed binary.
    options = {'entryPoints':['node_modules/jsqr/dist/jsQR.js'], 'bundle':True,
               'format':'esm', 'platform':'browser', 'outfile':str(output)}
    subprocess.run(['node', '-e',
                    "require('esbuild').buildSync(JSON.parse(process.argv[1]))",
                    json.dumps(options)], cwd=ROOT, check=True)


def package(source=None, output=None, acceptance=False):
    output = output or ROOT / 'bull-bitcoin/app'
    source = source or STAGE / 'build/web'
    if not (source / 'main.dart.js').is_file():
        raise RuntimeError('Build the original Flutter app first')
    allowed = [ROOT/'bull-bitcoin/app', ROOT/'.browser-work/bull-acceptance-app']
    if output.resolve() not in [path.resolve() for path in allowed]: raise RuntimeError('Unexpected packaging target')
    if output.exists(): shutil.rmtree(output)
    shutil.copytree(source, output, dirs_exist_ok=True)
    for library, name in [('bdk', 'bdk-web-pkg'), ('lwk', 'lwk-web-pkg')]:
        shutil.copytree(ROOT / '.browser-work' / name, output / 'native' / library, dirs_exist_ok=True)
    for name in ['runtime.js', 'qr_transport.js', 'storage.js']:
        shutil.copy2(ROOT / 'browser/bull' / name, output / name)
    native_notices(output)
    bundle_qr(output/'qr_decoder.js')
    manifest = {
        'source':'https://github.com/SatoshiPortal/bullbitcoin-mobile',
        'commit':'98eb380f74a507ce1bcb6848bd2d77cf46959f9e',
        'flutter':'3.44.9', 'dart':'3.12.2', 'rust':'1.98.1',
        'test_only':acceptance,
        'native_sources':{
            'bull_sdk':'88e05c9e9d2911f3dcd44b449ee97e27c73c1e51',
            'bdk_dart':'fbf8952ed7056c9663e4bd47dddc8b4994580532',
            'bdk_ffi':'17c48b8b52ba81cdc58531e75ad1165be0cc25d9',
            'lwk_dart':'f554c7842f1f4b8e59c72d10a6f0747cb03fa315',
        },
        'assets':{str(path.relative_to(output)).replace('\\','/'):hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(output.rglob('*')) if path.is_file()},
    }
    (output/'build-info.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Staged actual Bull Bitcoin browser app at {output}')


if __name__ == '__main__':
    package()
