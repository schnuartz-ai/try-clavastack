// FFI boundary for the upstream generated UniFFI codec. This file implements
// byte buffers and opaque handles; Bitcoin operations execute in the Rust WASM.
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';
import 'bdk.dart'
    show
        RustBuffer,
        RustCallStatus,
        ForeignBytes,
        UniffiVTableCallbackInterfacePersistence,
        UniffiVTableCallbackInterfaceFullScanScriptInspector,
        UniffiVTableCallbackInterfaceSyncScriptInspector,
        UniffiForeignFuture;

@JS('bullBdkCall')
external JSString _call(JSString name, JSString args);

Object? _encode(Object? value) {
  if (value is RustBuffer) {
    return {'buffer': base64Encode(value.asUint8List())};
  }
  if (value is ForeignBytes) {
    return {'buffer': base64Encode(value.data.asTypedList(value.len))};
  }
  if (value is Pointer<RustCallStatus>) return null;
  if (value is Pointer) return value.address.toString();
  return value;
}

Object? wireCall(String name, List<Object?> args) {
  final decoded =
      jsonDecode(
            _call(
              name.toJS,
              jsonEncode(args.map(_encode).toList()).toJS,
            ).toDart,
          )
          as Map<String, dynamic>;
  for (final arg in args) {
    if (arg is Pointer<RustCallStatus>) {
      arg.ref.code = (decoded['status'] as num).toInt();
      arg.ref.errorBuf = wireBuffer({'buffer': decoded['error']});
    }
  }
  return decoded['result'];
}

int wireNumber(Object? value) {
  final integer = BigInt.parse(value.toString());
  if (integer.abs() > BigInt.from(0x1fffffffffffff)) {
    throw RangeError('Native integer exceeds exact JavaScript integer range');
  }
  return integer.toInt();
}

int wireHash(Object? value) => BigInt.parse(value.toString()).hashCode;
double wireDouble(Object? value) => double.parse(value.toString());
Pointer<T> wirePointer<T>(Object? value) =>
    Pointer<T>.fromAddress((value as Map<String, dynamic>)['pointer'] as int);
RustBuffer wireBuffer(Object? value) {
  final bytes = base64Decode(
    (value as Map<String, dynamic>)['buffer'] as String,
  );
  return RustBuffer.empty()
    ..capacity = bytes.length
    ..len = bytes.length
    ..data = Pointer<Uint8>.fromBytes(bytes);
}

class Struct {}

class Void {}

class NativeFunction<T> {}

class Int8 {}

class Uint8 {}

class Int16 {}

class Uint16 {}

class Int32 {}

class Uint32 {}

class Int64 {}

class Uint64 {}

class IntPtr {}

class UintPtr {}

class Double {}

class Float {}

class Pointer<T> {
  final int address;
  Object? _value;
  Pointer.fromAddress(this.address);
  Pointer.fromBytes(Uint8List bytes) : address = 0, _value = bytes;
  Pointer.local(Object value) : address = 0, _value = value;
  T get ref => _value as T;
  set ref(T value) {
    _value = value;
  }

  Object? get value => _value;
  set value(Object? value) => _value = value;
  Uint8List asTypedList(int length) {
    final bytes = _value as Uint8List;
    return Uint8List.view(bytes.buffer, bytes.offsetInBytes, length);
  }

  Pointer<U> cast<U>() => Pointer<U>.fromAddress(address).._value = _value;
  static Pointer<NativeFunction<F>> fromFunction<F>(
    Function callback, [
    Object? exceptionalReturn,
  ]) =>
      throw UnsupportedError('Foreign native callbacks are unavailable in web');
  F asFunction<F>() => throw UnsupportedError('Native function pointer in web');
}

final Pointer<Never> nullptr = Pointer<Never>.fromAddress(0);

class _Calloc {
  Pointer<T> call<T>([int length = 1]) {
    final Object value;
    if (T == RustCallStatus) {
      value = RustCallStatus();
    } else if (T == ForeignBytes) {
      value = ForeignBytes();
    } else if (T == RustBuffer) {
      value = RustBuffer.empty();
    } else if (T == Uint8) {
      return Pointer<T>.fromBytes(Uint8List(length));
    } else if (T == UniffiVTableCallbackInterfacePersistence) {
      value = UniffiVTableCallbackInterfacePersistence();
    } else if (T == UniffiVTableCallbackInterfaceFullScanScriptInspector) {
      value = UniffiVTableCallbackInterfaceFullScanScriptInspector();
    } else if (T == UniffiVTableCallbackInterfaceSyncScriptInspector) {
      value = UniffiVTableCallbackInterfaceSyncScriptInspector();
    } else if (T == UniffiForeignFuture) {
      value = UniffiForeignFuture();
    } else {
      throw UnsupportedError('Native allocation in web: $T');
    }
    return Pointer<T>.local(value);
  }

  void free(Object value) {}
}

final calloc = _Calloc();

extension BrowserInt64Codec on ByteData {
  int _read64(int offset, Endian endian, bool signed) {
    final high = getUint32(offset + (endian == Endian.big ? 0 : 4), endian);
    final low = getUint32(offset + (endian == Endian.big ? 4 : 0), endian);
    var value = (BigInt.from(high) << 32) | BigInt.from(low);
    if (signed) value = value.toSigned(64);
    if (value.abs() > BigInt.from(0x1fffffffffffff)) {
      throw RangeError('UniFFI integer exceeds exact JavaScript integer range');
    }
    return value.toInt();
  }

  int getBrowserInt64(int offset, [Endian endian = Endian.big]) =>
      _read64(offset, endian, true);
  int getBrowserUint64(int offset, [Endian endian = Endian.big]) =>
      _read64(offset, endian, false);
  void _write64(int offset, int value, Endian endian) {
    if (value.abs() > 0x1fffffffffffff) {
      throw RangeError('UniFFI integer exceeds exact JavaScript integer range');
    }
    final bits = BigInt.from(value).toUnsigned(64);
    setUint32(
      offset + (endian == Endian.big ? 0 : 4),
      (bits >> 32).toInt(),
      endian,
    );
    setUint32(
      offset + (endian == Endian.big ? 4 : 0),
      (bits & BigInt.from(0xffffffff)).toInt(),
      endian,
    );
  }

  void setBrowserInt64(int offset, int value, [Endian endian = Endian.big]) =>
      _write64(offset, value, endian);
  void setBrowserUint64(int offset, int value, [Endian endian = Endian.big]) =>
      _write64(offset, value, endian);
}

class NativeCallable<T> {
  NativeCallable.listener(Function callback);
  Pointer<NativeFunction<T>> get nativeFunction =>
      throw UnsupportedError('Native async continuation in browser');
  void close() {}
}
