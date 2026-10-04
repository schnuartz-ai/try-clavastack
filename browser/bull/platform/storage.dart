// Session-only browser persistence. The original app retains its own seed
// encryption, repository, PIN and migration logic above this platform layer.
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart'
    as secure;
import 'package:flutter_secure_storage_legacy_platform_interface/flutter_secure_storage_platform_interface.dart'
    as legacy;
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';
import 'package:shared_preferences_platform_interface/types.dart';
import 'io.dart' show browserIo;
import 'dart:js_interop';
import 'package:flutter/widgets.dart';
import 'files.dart';

@JS('bullAppMounted')
external void _appMounted();

void registerBrowserStorage() {
  registerBrowserFiles();
  secure.FlutterSecureStoragePlatform.instance = BrowserSecureStorage();
  legacy.FlutterSecureStoragePlatform.instance = BrowserLegacyStorage();
  SharedPreferencesStorePlatform.instance = BrowserPreferences();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    _appMounted();
  });
}

class BrowserSecureStorage extends secure.FlutterSecureStoragePlatform {
  final String namespace;
  BrowserSecureStorage([this.namespace = 'secrets']);
  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) async {
    browserIo('storeWrite', {'store': namespace, 'key': key, 'value': value});
  }

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async =>
      browserIo('storeRead', {'store': namespace, 'key': key}) as String?;
  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async => await read(key: key, options: options) != null;
  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async {
    browserIo('storeDelete', {'store': namespace, 'key': key});
  }

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async => (browserIo('storeAll', namespace) as Map).cast<String, String>();
  @override
  Future<void> deleteAll({required Map<String, String> options}) async {
    browserIo('storeClear', namespace);
  }
}

class BrowserLegacyStorage extends legacy.FlutterSecureStoragePlatform {
  final BrowserSecureStorage _storage = BrowserSecureStorage('legacySecrets');
  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) => _storage.write(key: key, value: value, options: options);
  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) => _storage.read(key: key, options: options);
  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) => _storage.containsKey(key: key, options: options);
  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) => _storage.delete(key: key, options: options);
  @override
  Future<Map<String, String>> readAll({required Map<String, String> options}) =>
      _storage.readAll(options: options);
  @override
  Future<void> deleteAll({required Map<String, String> options}) =>
      _storage.deleteAll(options: options);
}

class BrowserPreferences extends SharedPreferencesStorePlatform {
  @override
  Future<bool> remove(String key) async {
    browserIo('storeDelete', {'store': 'preferences', 'key': key});
    return true;
  }

  @override
  Future<bool> setValue(String valueType, String key, Object value) async {
    browserIo('storeWrite', {
      'store': 'preferences',
      'key': key,
      'value': value,
    });
    return true;
  }

  @override
  Future<bool> clear() => clearWithParameters(
    ClearParameters(filter: PreferencesFilter(prefix: 'flutter.')),
  );
  @override
  Future<bool> clearWithPrefix(String prefix) => clearWithParameters(
    ClearParameters(filter: PreferencesFilter(prefix: prefix)),
  );
  @override
  Future<bool> clearWithParameters(ClearParameters parameters) async {
    for (final key in (await getAllWithParameters(
      GetAllParameters(filter: parameters.filter),
    )).keys) {
      await remove(key);
    }
    return true;
  }

  @override
  Future<Map<String, Object>> getAll() => getAllWithPrefix('flutter.');
  @override
  Future<Map<String, Object>> getAllWithPrefix(String prefix) =>
      getAllWithParameters(
        GetAllParameters(filter: PreferencesFilter(prefix: prefix)),
      );
  @override
  Future<Map<String, Object>> getAllWithParameters(
    GetAllParameters parameters,
  ) async {
    final data = (browserIo('storeAll', 'preferences') as Map)
        .cast<String, Object>();
    final filter = parameters.filter;
    data.removeWhere(
      (key, value) =>
          !key.startsWith(filter.prefix) ||
          (filter.allowList != null && !filter.allowList!.contains(key)),
    );
    return data.map(
      (key, value) =>
          MapEntry(key, value is List ? value.cast<String>() : value),
    );
  }
}
