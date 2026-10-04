// Acceptance probe for the actual upstream Dart API and genuine Rust WASM.
// Inputs come exclusively from the shared public Ghost/Zoo fixture module.
import 'dart:convert';
import 'dart:js_interop';
import 'package:bdk_dart/bdk.dart' as bdk;

@JS('bullProbeInput')
external JSString get _input;
@JS('bullProbeDone')
external void _done(JSString value);

void main() {
  var phase = 'ABI checksums';
  try {
    final input = jsonDecode(_input.toDart) as Map<String, dynamic>;
    bdk.ensureInitialized();
    phase = 'mnemonic';
    final mnemonic = bdk.Mnemonic.fromString(
      mnemonic: input['mnemonic'] as String,
    );
    final secret = bdk.DescriptorSecretKey(
      networkKind: bdk.NetworkKind.test,
      mnemonic: mnemonic,
      password: '',
    );
    phase = 'descriptors';
    final external = bdk.Descriptor.newBip84(
      secretKey: secret,
      keychainKind: bdk.KeychainKind.external_,
      networkKind: bdk.NetworkKind.test,
    );
    final internal = bdk.Descriptor.newBip84(
      secretKey: secret,
      keychainKind: bdk.KeychainKind.internal,
      networkKind: bdk.NetworkKind.test,
    );
    phase = 'wallet';
    final wallet = bdk.Wallet(
      descriptor: external,
      changeDescriptor: internal,
      network: bdk.Network.testnet,
      persister: bdk.Persister.newInMemory(),
      lookahead: 25,
    );
    final address = wallet.nextUnusedAddress(
      keychain: bdk.KeychainKind.external_,
    );
    phase = 'PSBT';
    final psbt = bdk.Psbt(psbtBase64: (input['psbt'] as String).trim());
    final options = bdk.SignOptions(
      trustWitnessUtxo: true,
      allowAllSighashes: false,
      tryFinalize: true,
      signWithTapInternalKey: true,
      allowGrinding: true,
    );
    final finalized = wallet.sign(psbt: psbt, signOptions: options);
    phase = 'result';
    _done(
      jsonEncode({
        'ok': true,
        'address': address.address.toString(),
        'descriptor': wallet.publicDescriptor(
          keychain: bdk.KeychainKind.external_,
        ),
        'balance': wallet.balance().total.toSat(),
        'signed': psbt.serialize(),
        'finalized': finalized,
        'txid': psbt.extractTx().computeTxid().toString(),
      }).toJS,
    );
  } catch (error, stack) {
    _done(
      jsonEncode({
        'ok': false,
        'type': error.runtimeType.toString(),
        'phase': phase,
        'stack': stack.toString(),
      }).toJS,
    );
  }
}
