import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';
import 'package:ur/ur.dart';
import 'package:ur/ur_encoder.dart';
import 'package:ur/ur_decoder.dart';

@JS('bullUrInput')
external JSString get _input;
@JS('bullUrDone')
external void _done(JSString result);

void main() {
  try {
    final input = jsonDecode(_input.toDart) as Map<String, dynamic>;
    final bytes = base64Decode(input['cbor'] as String);
    final decoder = URDecoder();
    for (final frame in input['frames'] as List) {
      decoder.receivePart(frame as String);
    }
    if (!decoder.isSuccess())
      throw StateError('Fountain decoder did not complete');
    final decoded = decoder.resultMessage() as UR;
    if (base64Encode(decoded.cbor) != base64Encode(bytes))
      throw StateError('Decoded payload differs');
    final encoder = UREncoder(UR('crypto-psbt', Uint8List.fromList(bytes)), 60);
    final frames = List.generate(100, (_) => encoder.nextPart());
    _done(jsonEncode({'ok': true, 'frames': frames}).toJS);
  } catch (error) {
    _done(jsonEncode({'ok': false, 'error': error.toString()}).toJS);
  }
}
