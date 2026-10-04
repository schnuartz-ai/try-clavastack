import 'dart:convert';
import 'dart:js_interop';
import 'package:bull_sdk/lwk.dart' as lwk;

@JS('bullProbeInput')
external JSString get _input;
@JS('bullProbeDone')
external void _done(JSString value);

Future<void> main() async {
  var phase = 'descriptor';
  try {
    final data = jsonDecode(_input.toDart) as Map<String, dynamic>;
    final descriptor = await lwk.Descriptor.newConfidential(
      network: lwk.LiquidNetwork.testnet,
      mnemonic: data['mnemonic'] as String,
    );
    phase = 'wallet';
    final wallet = await lwk.Wallet.init(
      network: lwk.LiquidNetwork.testnet,
      dbpath: '/public-ghost-lwk',
      descriptor: descriptor,
    );
    final address = await wallet.address(index: 0);
    phase = 'reopen';
    final again = await lwk.Wallet.init(
      network: lwk.LiquidNetwork.testnet,
      dbpath: '/public-ghost-lwk',
      descriptor: descriptor,
    );
    if ((await again.address(index: 0)).confidential != address.confidential)
      throw StateError('Reopened LWK address differs');
    if (await lwk.Address.validate(addressString: address.confidential) !=
        lwk.LiquidNetwork.testnet)
      throw StateError('Wrong LWK network');
    phase = 'invalid transaction';
    var rejected = false;
    try {
      lwk.LiquidTransaction.fromBytes(txBytes: [1, 2, 3]);
    } catch (_) {
      rejected = true;
    }
    if (!rejected)
      throw StateError('Malformed Elements transaction was accepted');
    phase = 'result';
    _done(
      jsonEncode({
        'ok': true,
        'address': address.confidential,
        'reopened': true,
        'balance': (await wallet.balances())
            .fold<BigInt>(
              BigInt.zero,
              (sum, b) => sum + BigInt.parse(b.value.toString()),
            )
            .toString(),
        'invalidRejected': rejected,
      }).toJS,
    );
  } catch (error) {
    _done(
      jsonEncode({'ok': false, 'phase': phase, 'error': error.toString()}).toJS,
    );
  }
}
