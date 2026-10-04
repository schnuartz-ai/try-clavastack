"""Precisely patch native storage/camera boundaries in disposable app source."""
from pathlib import Path
import re
from prepare import ROOT, STAGE, DEPS
from apply import change, dependency

def original(path):
    return (ROOT / 'upstream/bullbitcoin' / path).read_text().replace("'dart:io'", "'package:bull_browser_platform/io.dart'").replace("'package:path_provider/path_provider.dart'", "'package:bull_browser_platform/path_provider.dart'")

def replace_function(text, anchor, body):
    start = text.index(anchor)
    brace = text.index('{', start)
    depth, end = 1, brace + 1
    while depth:
        if text[end] == '{': depth += 1
        elif text[end] == '}': depth -= 1
        end += 1
    return text[:start]+body+text[end:]

def generate():
    platform = DEPS / 'bull_browser_platform'
    import shutil
    shutil.copytree(ROOT / 'browser/bull/platform', platform / 'lib', dirs_exist_ok=True)
    (platform / 'pubspec.yaml').write_text('''name: bull_browser_platform
version: 0.1.0
environment:
  sdk: ">=3.12.2 <4.0.0"
dependencies:
  flutter:
    sdk: flutter
  web: 1.1.1
  drift: 2.31.0
  file_picker: 10.3.6
  share_plus_platform_interface: 6.1.0
  flutter_secure_storage_platform_interface: 2.0.3
  flutter_secure_storage_legacy_platform_interface:
  shared_preferences_platform_interface: 2.4.2
''')
    p = STAGE / 'lib/core/storage/sqlite_database.dart'
    text = original('lib/core/storage/sqlite_database.dart')
    for imp in ["import 'package:drift/native.dart';", "import 'package:drift_flutter/drift_flutter.dart';",
                "import 'package:bull_browser_platform/io.dart';", "import 'package:flutter/services.dart';",
                "import 'package:path/path.dart' as p;", "import 'package:bull_browser_platform/path_provider.dart';"]: text = text.replace(imp, '')
    text = text.replace("part 'sqlite_database.g.dart';", "import 'package:bull_browser_platform/database.dart';\n\npart 'sqlite_database.g.dart';")
    text = replace_function(text, '  static Future<DriftIsolate> createIsolateWithSpawn()', '''  static Future<DriftIsolate> createIsolateWithSpawn() async {
    throw UnsupportedError('Native background isolates are unavailable in the browser');
  }''')
    text = replace_function(text, '  static QueryExecutor _openConnection()', '''  static QueryExecutor _openConnection() => browserDatabase(name);''')
    p.write_text(text)
    p = STAGE / 'lib/core/widgets/qr_scanner_widget.dart'
    text = original('lib/core/widgets/qr_scanner_widget.dart')
    start = text.index('        ReaderWidget('); end = text.index('\n\n        // UR Progress Display',start)
    text = text[:start] + '        BrowserQrReaderWidget(onScanned:(frame) { if(mounted) _processQrData(frame); }),' + text[end:]
    text = text.replace('    zx.stopCameraProcessing();','')
    p.write_text("import 'package:bull_browser_platform/qr.dart';\n"+text)
    p = STAGE / 'lib/core/widgets/qr_display_widget.dart'
    text = original('lib/core/widgets/qr_display_widget.dart').replace('child: QrImageView(data: data),','child: BrowserQrOutput(data:data,child:QrImageView(data: data)),')
    p.write_text("import 'package:bull_browser_platform/qr.dart';\n"+text)
    p = STAGE / 'lib/core/wallet/data/datasources/bdk_wallet_datasource.dart'
    text = original('lib/core/wallet/data/datasources/bdk_wallet_datasource.dart')
    text = text.replace('final RootIsolateToken rootIsolateToken;', 'final RootIsolateToken? rootIsolateToken;').replace('ServicesBinding.rootIsolateToken!', 'ServicesBinding.rootIsolateToken')
    text = text.replace('BackgroundIsolateBinaryMessenger.ensureInitialized(params.rootIsolateToken);', 'if (!kIsWeb) { BackgroundIsolateBinaryMessenger.ensureInitialized(params.rootIsolateToken!); }')
    text = re.sub(r'  final blockchain = _createElectrumClient\(.*?\n  \);', '', text, flags=re.S)
    for wallet in ['bdkWallet','wallet']:
        text = re.sub(r'    final scanRequest = '+wallet+r'\.startFullScan\(\)\.build\(\);\n    final update = blockchain.fullScan\(.*?\n    \);', f'    final update = await bdk.browserFullScan(wallet: {wallet}, stopGap: params.electrumStopGap);', text, flags=re.S)
    text = text.replace('        await compute(\n          _performFullScan,', "        if (electrumServer.isCustom || electrumServer.socks5?.isNotEmpty == true) { throw UnsupportedError('Custom Electrum and Tor TCP transport require a native app'); }\n        await compute(\n          _performFullScan,")
    # The two native Electrum-only helpers are the final declarations.
    if text.count('int _batchSizeFor(') != 1: raise RuntimeError('Electrum helper anchor differs')
    text = text[:text.index('int _batchSizeFor(')]
    p.write_text(text)
    p = STAGE / 'packages/bull_payjoin/lib/src/data/payjoin_database.dart'
    btc_source = 'lib/core/blockchain/data/datasources/bdk_bitcoin_blockchain_datasource.dart'
    text = original(btc_source)
    text = "import 'package:bull_browser_platform/transport.dart';\nimport 'package:convert/convert.dart';\n" + text
    text = text.replace('required ElectrumConnection connection,', 'required ElectrumConnection connection,\n    required bool isTestnet,')
    text = text.replace('final blockchain = await _createClient(connection);', '_checkConnection(connection);')
    text = text.replace('final txId = blockchain.transactionBroadcast(tx: tx);\n    return txId.toString();', 'return broadcastNativeTransaction(hex:hex.encode(tx.serialize()), txid:tx.computeTxid().toString(), isTestnet:isTestnet);')
    text = text[:text.index('  static Future<bdk.ElectrumClient> _createClient(')] + '''  static void _checkConnection(ElectrumConnection connection) {
    if (connection.isCustom || connection.socks5?.isNotEmpty == true) { throw UnsupportedError('Custom Electrum and Tor TCP transport require a native app'); }
  }
}
'''
    (STAGE / btc_source).write_text(text)
    btc_repo = 'lib/core/blockchain/data/repository/bitcoin_blockchain_repository.dart'
    text = original(btc_repo).replace('connection: connection)', 'connection: connection, isTestnet:isTestnet)').replace('        connection: connection,', '        connection: connection,\n        isTestnet:isTestnet,')
    (STAGE / btc_repo).write_text(text)
    # Upstream normalizes SLIP-132 keys to mainnet xpub bytes before creating
    # descriptors. BDK 3 rejects those bytes with NetworkKind.test. Preserve
    # the public key and use the app's existing version conversion for Testnet.
    metadata = 'lib/core/wallet/wallet_metadata_service.dart'
    text = original(metadata)
    anchor = 'final xpubBase58 = bip32Xpub.toBase58();'
    if text.count(anchor) != 1: raise RuntimeError('Watch-only key normalization anchor differs')
    text = text.replace(anchor, 'final xpubBase58 = network.isTestnet ? bip32Xpub.convert(XpubType.tpub) : bip32Xpub.toBase58();')
    (STAGE / metadata).write_text(text)
    payjoin_adapter = 'lib/payjoin_runtime_adapters.dart'
    text = original(payjoin_adapter).replace('connection: connection)', 'connection: connection, isTestnet: !network.isMainnet)')
    (STAGE / payjoin_adapter).write_text(text)
    liquid_source = 'lib/core/blockchain/data/datasources/lwk_liquid_blockchain_datasource.dart'
    (STAGE / liquid_source).write_text('''import 'package:bull_sdk/lwk.dart' as lwk;
import 'package:convert/convert.dart';
import 'package:bull_browser_platform/transport.dart';
import 'package:bb_mobile/core/electrum/domain/value_objects/electrum_connection.dart';

class LwkLiquidBlockchainDatasource {
  const LwkLiquidBlockchainDatasource();
  Future<String> broadcastTransaction({required String signedPset, required ElectrumConnection connection, required bool isTestnet}) async {
    if (connection.isCustom || connection.socks5?.isNotEmpty == true) { throw UnsupportedError('Custom Electrum and Tor TCP transport require a native app'); }
    final tx = lwk.PartiallySignedElementsTransaction.fromString(psetString:signedPset).extractTx();
    return broadcastNativeTransaction(hex:hex.encode(tx.toBytes()), txid:tx.txid(), isTestnet:isTestnet, isLiquid:true);
  }
}
''')
    liquid_repo = 'lib/core/blockchain/data/repository/liquid_blockchain_repository_impl.dart'
    text = original(liquid_repo).replace('electrumServerUrl: connection.url,', 'connection: connection,\n        isTestnet:isTestnet,')
    (STAGE / liquid_repo).write_text(text)
    text = original('packages/bull_payjoin/lib/src/data/payjoin_database.dart').replace("import 'package:drift/native.dart';", "import 'package:bull_browser_platform/database.dart';")
    text = text.replace("import 'package:bull_browser_platform/io.dart';", '')
    text = replace_function(text, '  factory PayjoinDatabase.open(String path)', '''  factory PayjoinDatabase.open(String path) => PayjoinDatabase._(browserDatabase('payjoin'));''')
    p.write_text(text)
    p = STAGE / 'lib/main.dart'; text = original('lib/main.dart').replace('        WidgetsFlutterBinding.ensureInitialized();', '        WidgetsFlutterBinding.ensureInitialized();\n        registerBrowserStorage();'); p.write_text("import 'package:bull_browser_platform/storage.dart';\n"+text)
    # The native Flutter Rust Bridge uses int64 on VM and BigInt on JS. Its
    # original app callers need an explicit conversion at that type boundary.
    p = STAGE / 'lib/core/wallet/data/datasources/lwk_wallet_datasource.dart'
    text = original('lib/core/wallet/data/datasources/lwk_wallet_datasource.dart').replace('.value.abs()', '.value.toInt().abs()').replace('.map((e) => e.value)', '.map((e) => e.value.toInt())')
    text = text.replace('finalBalance = lbtcBalance?.value ?? 0', 'finalBalance = lbtcBalance?.value.toInt() ?? 0')
    text = text.replace('        final lwkWallet = await LwkFacade.createPublicWallet(wallet);', "        if (electrumServer.isCustom || electrumServer.socks5?.isNotEmpty == true) { throw UnsupportedError('Custom Electrum and Tor TCP transport require a native app'); }\n        final lwkWallet = await LwkFacade.createPublicWallet(wallet);")
    p.write_text(text)
    p = STAGE / 'lib/features/swap/data/mappers/order_swap_record_mapper.dart'
    text = original('lib/features/swap/data/mappers/order_swap_record_mapper.dart').replace('const max = 0x7fffffffffffffff;', "final max = BigInt.parse('9223372036854775807');").replace('BigInt.from(max)', 'max')
    p.write_text(text)
    # Preserve the original payjoin API/models with an explicit unsupported
    # native-call boundary until its OHTTP/CONNECT transport is ported.
    pj = DEPS / 'payjoin/lib/payjoin.dart'
    cache = ROOT / '.browser-work/payjoin-original.dart'
    text = cache.read_text()
    text = text.replace('import "dart:ffi";', 'import "browser_ffi.dart";').replace('import "package:ffi/ffi.dart";', '')
    pattern = re.compile(r'@Native<.*?>\(\s*assetId:\s*_uniffiAssetId,?\s*\)\s*external\s+([^;]+);', re.S)
    text = pattern.sub(lambda m: m.group(1)+" { throw UnsupportedError('Native Payjoin OHTTP is unavailable in this browser'); }", text)
    text = re.sub(r'@(Int8|Int32|Uint64)\(\)\s*', '', text)
    text = re.sub(r'external (int|Pointer<Uint8>|RustBuffer) (\w+);', lambda m: f'{m.group(1)} {m.group(2)} = '+('0;' if m.group(1)=='int' else 'RustBuffer.empty();' if m.group(1)=='RustBuffer' else 'Pointer<Uint8>.fromBytes(Uint8List(0));'), text)
    text = re.sub(r'external\s+([^;]+);', r'late \1;', text)
    text = text.replace('class RustBuffer extends Struct {', 'class RustBuffer extends Struct {\n  RustBuffer.empty();')
    text = text.replace('value < -9223372036854775808 || value > 9223372036854775807', "BigInt.from(value) < BigInt.parse('-9223372036854775808') || BigInt.from(value) > BigInt.parse('9223372036854775807')")
    for method in ['getInt64','getUint64','setInt64','setUint64']:
        text = text.replace('.'+method+'(', '.'+method.replace('Int64','BrowserInt64').replace('Uint64','BrowserUint64')+'(')
    pj.write_text(text)
    shim = (ROOT / 'browser/bull/browser_ffi.dart').read_text().replace("'bdk.dart'", "'payjoin.dart'").replace('bullBdkCall', 'bullPayjoinCall')
    shim = re.sub(r'} else if \(T == UniffiVTable\w+\) \{\s*value = \w+\(\);', '', shim)
    # Those vtables are native callbacks; allocation is explicitly unsupported.
    shim = shim.replace('}\n    } else', '} else')
    (pj.parent / 'browser_ffi.dart').write_text(shim)
    # This bc-ur package is the original pinned code; xoshiro's 64-bit mask
    # is already BigInt throughout. Parse its literal exactly on JS.
    ur = dependency('ur')
    const = ur / 'lib/constants.dart'
    text = const.read_text().replace('const int MAX_UINT64 = 0xFFFFFFFFFFFFFFFF;', "final BigInt MAX_UINT64 = BigInt.parse('18446744073709551615');")
    const.write_text(text)
    rng = ur / 'lib/xoshiro256.dart'
    text = (ROOT / '.browser-work/ur-original-xoshiro.dart').read_text()
    text = text.replace('int rotl(int x, int k)', 'BigInt rotl(BigInt x, int k)').replace('(x << k) | (x >>> (64 - k))', '((x << k) | (x.toUnsigned(64) >> (64 - k))).toUnsigned(64)')
    text = text.replace('final List<int> JUMP', 'final List<BigInt> JUMP').replace('final List<int> LONG_JUMP', 'final List<BigInt> LONG_JUMP')
    text = re.sub(r'0x([0-9a-f]{16})', r"BigInt.parse('\1', radix:16)", text)
    text = text.replace('List<int> s = List<int>.filled(4, 0)', 'List<BigInt> s = List<BigInt>.filled(4, BigInt.zero)').replace('s[i] = arr[i];', 's[i] = BigInt.from(arr[i]);')
    text = text.replace('int v = 0;', 'BigInt v = BigInt.zero;').replace('v |= arr[o + n];', 'v |= BigInt.from(arr[o + n]);')
    text = text.replace('rotl(s[1] * 5, 7) * 9', 'rotl((s[1] * BigInt.from(5)).toUnsigned(64), 7) * BigInt.from(9)').replace('BigInt.from(resultRaw)', 'resultRaw').replace('int t = (s[1] << 17)', 'BigInt t = (s[1] << 17).toUnsigned(64)')
    text = text.replace('BigInt.from(MAX_UINT64)', 'MAX_UINT64').replace('return (nextDouble() * (high - low + 1) + low).floor() & MAX_UINT64;', 'return (BigInt.from((nextDouble() * (high - low + 1) + low).floor()) & MAX_UINT64).toInt();')
    text = text.replace('int s0 = 0, s1 = 0, s2 = 0, s3 = 0;', 'BigInt s0 = BigInt.zero, s1 = BigInt.zero, s2 = BigInt.zero, s3 = BigInt.zero;').replace('(1 << b)) != 0', '(BigInt.one << b)) != BigInt.zero')
    rng.write_text(text)
    legacy = dependency('flutter_secure_storage_legacy_platform_interface')
    overrides = STAGE / 'pubspec_overrides.yaml'
    text = overrides.read_text()
    if '  ur:' not in text: overrides.write_text(text+'  ur:\n    path: ../bull-deps/ur\n')
    text = overrides.read_text()
    if '  flutter_secure_storage_legacy_platform_interface:' not in text: overrides.write_text(text+'  flutter_secure_storage_legacy_platform_interface:\n    path: ../bull-deps/flutter_secure_storage_legacy_platform_interface\n')
    (STAGE / 'web/drift_worker.dart').write_text("import 'package:drift/wasm.dart';\nvoid main() { WasmDatabase.workerMainForOpen(); }\n")
    index = STAGE / 'web/index.html'
    if index.exists():
        index.write_text(index.read_text().replace('<script src="flutter_bootstrap.js" async></script>', '<script type="module" src="runtime.js"></script>').replace('<title>bb_mobile</title>', '<title>Bull Bitcoin Simulator</title>'))
    print('Applied actual app browser storage boundaries')

if __name__ == '__main__': generate()
