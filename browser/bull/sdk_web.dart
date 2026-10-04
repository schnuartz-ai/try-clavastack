// Platform transport for the pinned native Bull SDK. Wallet mathematics and
// validation are performed by the original Rust methods compiled to WASM.
@JS('bullLwkCall')
external JSString _lwkCall(JSString operation, JSString arguments);
@JS('bullLwkAsyncCall')
external JSPromise<JSString> _lwkAsyncCall(
  JSString operation,
  JSString arguments,
);
@JS('bullNativeReady')
external JSBoolean get _nativeReady;

dynamic _call(String operation, Map<String, dynamic> arguments) {
  try {
    return jsonDecode(
      _lwkCall(operation.toJS, jsonEncode(arguments).toJS).toDart,
    );
  } catch (error) {
    throw LwkError(msg: error.toString());
  }
}

Future<dynamic> _asyncCall(
  String operation,
  Map<String, dynamic> arguments,
) async {
  try {
    return jsonDecode(
      (await _lwkAsyncCall(
        operation.toJS,
        jsonEncode(arguments).toJS,
      ).toDart).toDart,
    );
  } catch (error) {
    throw LwkError(msg: error.toString());
  }
}

class BullSdk {
  BullSdk._();
  static final instance = BullSdk._();
  final BullSdkApi api = BrowserBullSdkApi();
  static Future<void> init() async {
    if (!_nativeReady.toDart)
      throw StateError('Bull Bitcoin WASM libraries are not initialized');
  }

  static void dispose() {}
}

class BrowserBullSdkApi extends BullSdkApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'This native Bull SDK capability is unavailable in a browser: ${invocation.memberName}',
  );

  @override
  Future<Descriptor> lwkApiDescriptorDescriptorNewConfidential({
    required LiquidNetwork network,
    required String mnemonic,
  }) async => decodeDescriptor(
    _call('descriptor', {'network': network.name, 'mnemonic': mnemonic}),
  );
  @override
  Future<Wallet> lwkApiWalletWalletInit({
    required LiquidNetwork network,
    required String dbpath,
    required Descriptor descriptor,
  }) async {
    final path =
        _call('walletInit', {
              'network': network.name,
              'path': dbpath,
              'descriptor': descriptor.ctDescriptor,
            })
            as String;
    return BrowserWallet(path);
  }

  @override
  String lwkApiTypesGetLbtcAssetId() => _call('lbtcAssetId', {}) as String;
  @override
  String lwkApiTypesGetLtestAssetId() => _call('ltestAssetId', {}) as String;
  @override
  BigInt lwkApiTypesGetBalanceByAssetId({
    required List<WalletBalance> balances,
    required String assetId,
  }) => BigInt.parse(
    _call('balanceByAssetId', {
      'balances': balances
          .map((b) => {'assetId': b.assetId, 'value': b.value.toString()})
          .toList(),
      'assetId': assetId,
    }).toString(),
  );
  @override
  BigInt lwkApiTypesGetLbtcBalance({required List<WalletBalance> balances}) =>
      lwkApiTypesGetBalanceByAssetId(
        balances: balances,
        assetId: lwkApiTypesGetLbtcAssetId(),
      );
  @override
  BigInt lwkApiTypesGetLtestBalance({required List<WalletBalance> balances}) =>
      lwkApiTypesGetBalanceByAssetId(
        balances: balances,
        assetId: lwkApiTypesGetLtestAssetId(),
      );
  @override
  Future<Address> lwkApiTypesAddressAddressFromScript({
    required LiquidNetwork network,
    required String script,
    String? blindingKey,
  }) async => decodeAddress(
    _call('addressFromScript', {
      'network': network.name,
      'script': script,
      'blindingKey': blindingKey,
    }),
  );
  @override
  Future<LiquidNetwork> lwkApiTypesAddressValidate({
    required String addressString,
  }) async => LiquidNetwork.values.byName(
    _call('addressValidate', {'address': addressString}) as String,
  );
  @override
  Future<Uint8List> lwkApiTransactionExtractTxBytes({
    required String pset,
  }) async => Uint8List.fromList(
    (_call('extractTxBytes', {'pset': pset}) as List).cast<int>(),
  );
  @override
  Future<SizeAndFees> lwkApiTransactionGetSizeAndAbsoluteFees({
    required String pset,
  }) async =>
      decodeSizeAndFees(_call('getSizeAndAbsoluteFees', {'pset': pset}));
  @override
  LiquidTransaction lwkApiTransactionLiquidTransactionFromBytes({
    required List<int> txBytes,
  }) => BrowserLiquidTransaction(
    Uint8List.fromList(
      (_call('liquidTransaction', {
                'txBytes': txBytes,
                'method': 'toBytes',
                'args': {},
              })
              as List)
          .cast<int>(),
    ),
  );
  @override
  LiquidTransaction lwkApiTransactionLiquidTransactionFromPset({
    required String psetString,
  }) => BrowserLiquidTransaction(
    Uint8List.fromList(
      (_call('elementsPset', {
                'pset': psetString,
                'method': 'extractTx',
                'args': {},
              })
              as List)
          .cast<int>(),
    ),
  );
  @override
  PartiallySignedElementsTransaction
  lwkApiTransactionPartiallySignedElementsTransactionFromString({
    required String psetString,
  }) => BrowserElementsPset(
    _call('elementsPset', {
          'pset': psetString,
          'method': 'toString',
          'args': {},
        })
        as String,
  );
  @override
  Future<String> lwkApiBlockchainBlockchainBroadcastSignedPset({
    required String electrumUrl,
    required String signedPset,
  }) async =>
      await _asyncCall('broadcastSignedPset', {
            'electrumUrl': electrumUrl,
            'signedPset': signedPset,
          })
          as String;
  @override
  Future<String> lwkApiBlockchainBlockchainBroadcastTxBytes({
    required String electrumUrl,
    required List<int> txBytes,
  }) async =>
      await _asyncCall('broadcastTxBytes', {
            'electrumUrl': electrumUrl,
            'txBytes': txBytes,
          })
          as String;
}

abstract class BrowserOpaque {
  bool _disposed = false;
  bool get isDisposed => _disposed;
  void dispose() {
    _disposed = true;
  }

  void check() {
    if (_disposed) throw StateError('Native wallet handle is disposed');
  }
}

class BrowserWallet extends BrowserOpaque implements Wallet {
  final String path;
  BrowserWallet(this.path);
  dynamic _invoke(String method, Map<String, dynamic> args) {
    check();
    return _call('walletCall', {'path': path, 'method': method, 'args': args});
  }

  @override
  Future<void> sync_({
    required String electrumUrl,
    required bool validateDomain,
    int? stopAtIndex,
    int? timeout,
  }) async {
    check();
    await _asyncCall('walletSync', {
      'path': path,
      'electrumUrl': electrumUrl,
      'validateDomain': validateDomain,
      'stopAtIndex': stopAtIndex,
      'timeout': timeout,
    });
  }

  // The remaining methods are generated from the original public interface.
  /* WALLET METHODS */
}
