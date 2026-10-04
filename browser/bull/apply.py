"""Apply explicit browser platform boundaries to the disposable app copy."""
from pathlib import Path
import argparse
import json
import re
import shutil
from urllib.parse import unquote, urlparse
from prepare import ROOT, STAGE, DEPS


def cached_package(name):
    config = json.loads((STAGE / '.dart_tool/package_config.json').read_text())
    package = next(p for p in config['packages'] if p['name'] == name)
    uri = package['rootUri']
    if uri.startswith('file:'):
        path = unquote(urlparse(uri).path)
        if re.match(r'^/[A-Za-z]:', path): path = path[1:]
        return Path(path)
    return (STAGE / '.dart_tool' / uri).resolve()


def dependency(name):
    source = cached_package(name)
    target = DEPS / name
    if source.resolve() == target.resolve(): return target
    shutil.copytree(source, target, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('.git', '.dart_tool', 'build', 'target', 'hook'))
    return target


def overrides():
    # This is a disposable build overlay. The canonical pubspec and lockfile in
    # the submodule retain their reviewed GitHub refs.
    text = 'dependency_overrides:\n'
    for name in ['bdk_dart', 'payjoin', 'bull_sdk', 'onion', 'bull_browser_platform']:
        text += f'  {name}:\n    path: ../bull-deps/{name}\n'
    (STAGE / 'pubspec_overrides.yaml').write_text(text)


def apply_dependencies():
    for name in ['payjoin', 'bull_sdk', 'onion']:
        dependency(name)
    shutil.copy2(DEPS / 'payjoin/lib/payjoin.dart', ROOT / '.browser-work/payjoin-original.dart')
    ur = dependency('ur')
    shutil.copy2(ur / 'lib/xoshiro256.dart', ROOT / '.browser-work/ur-original-xoshiro.dart')
    platform = DEPS / 'bull_browser_platform'
    shutil.copytree(ROOT / 'browser/bull/platform', platform / 'lib', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'browser/bull/platform.pubspec.yaml', platform / 'pubspec.yaml')
    # bull_sdk's sibling onion dependency must resolve to the same copied
    # package; its native plugin is not required for this web adapter.
    sdk = DEPS / 'bull_sdk/pubspec.yaml'
    text = sdk.read_text()
    text = re.sub(r'  rust_lib_bull_sdk:\n    path: rust_builder\n', '', text)
    sdk.write_text(text)
    overrides()
    print('Prepared platform dependency overrides (upstream pins unchanged)')


def change(path, before, after):
    file = STAGE / path
    text = file.read_text(encoding='utf-8')
    if text.count(before) != 1:
        raise RuntimeError(f'Expected one platform anchor in {path}: {before[:80]}')
    file.write_text(text.replace(before, after), encoding='utf-8')


def apply_io():
    for root in ['lib', 'packages', 'features']:
        for file in (STAGE / root).rglob('*.dart'):
            if '/test/' in file.as_posix() or file.name.endswith(('.g.dart', '.freezed.dart')):
                continue
            text = file.read_text(encoding='utf-8')
            next_text = text.replace("'dart:io'", "'package:bull_browser_platform/io.dart'")
            next_text = next_text.replace("'package:path_provider/path_provider.dart'", "'package:bull_browser_platform/path_provider.dart'")
            if next_text != text:
                file.write_text(next_text, encoding='utf-8')
    # Native SQL/TCP tests retain their native OS imports. Logger tests use the
    # same filesystem type as the logger's browser platform boundary.
    for root in ['test', 'integration_test', 'packages']:
        for source in (ROOT / 'upstream/bullbitcoin' / root).rglob('*.dart'):
            if '/test/' not in source.as_posix() and root == 'packages': continue
            target = STAGE / source.relative_to(ROOT / 'upstream/bullbitcoin')
            if not target.exists(): continue
            text = source.read_text(encoding='utf-8')
            if '/bull_logger/test/' in source.as_posix() or source.name == 'issue_2598_test.dart':
                text = text.replace("'dart:io'", "'package:bull_browser_platform/io.dart'")
            target.write_text(text, encoding='utf-8')
    # Declare this platform dependency in each workspace member using it.
    paths = [STAGE / 'pubspec.yaml', *list((STAGE / 'packages').glob('*/pubspec.yaml')),
             *list((STAGE / 'features').glob('*/pubspec.yaml'))]
    for file in paths:
        if not any('package:bull_browser_platform/' in f.read_text(encoding='utf-8') for f in (file.parent / 'lib').rglob('*.dart')):
            continue
        text = file.read_text(encoding='utf-8')
        if '  bull_browser_platform:' not in text:
            file.write_text(text.replace('dependencies:\n', 'dependencies:\n  bull_browser_platform:\n', 1), encoding='utf-8')
    seed = STAGE / 'lib/core/storage/database_seeds.dart'
    text = seed.read_text()
    if 'environment: Environment.mainnet.name,' in text:
        change('lib/core/storage/database_seeds.dart',
               'environment: Environment.mainnet.name,', 'environment: Environment.testnet.name,')
    elif 'environment: Environment.testnet.name,' not in text:
        raise RuntimeError('Fresh network seed anchor differs')
    print('Applied session filesystem / browser OS / Testnet default boundaries')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dependencies', action='store_true')
    parser.add_argument('--io', action='store_true')
    args = parser.parse_args()
    if args.dependencies: apply_dependencies()
    if args.io: apply_io()
