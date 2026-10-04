// HTTPS replaces native sockets. Original libraries still parse, serialize,
// sign and calculate the expected transaction identifier.
import 'dart:convert';
import 'dart:js_interop';

@JS('bullBroadcast')
external JSPromise<JSString> _broadcast(JSString request);

Future<String> broadcastNativeTransaction({
  required String hex,
  required String txid,
  required bool isTestnet,
  bool isLiquid = false,
}) async {
  final result =
      jsonDecode(
            (await _broadcast(
              jsonEncode({
                'hex': hex,
                'txid': txid,
                'isTestnet': isTestnet,
                'isLiquid': isLiquid,
              }).toJS,
            ).toDart).toDart,
          )
          as Map<String, dynamic>;
  if (result['error'] != null) throw StateError(result['error'] as String);
  if (result['txid'] != txid)
    throw StateError(
      'Backend transaction identifier differs from the native transaction',
    );
  return txid;
}
