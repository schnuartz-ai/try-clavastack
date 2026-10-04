// FilePicker and SharePlus peripheral implementations. The original app owns
// the contents; these adapters only transfer bytes through the shared SD UI.
import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:share_plus_platform_interface/share_plus_platform_interface.dart';
import 'io.dart' show File;

@JS('bullPickFiles')
external JSPromise<JSString> _pick(JSString options);
@JS('bullSaveFile')
external JSPromise<JSString> _save(JSString options);

Future<String?> saveBrowserFile(String name, List<int> bytes) async {
  final result =
      jsonDecode(
            (await _save(
              jsonEncode({'name': name, 'bytes': base64Encode(bytes)}).toJS,
            ).toDart).toDart,
          )
          as Map<String, dynamic>;
  return result['path'] as String?;
}

class BrowserFilePicker extends FilePicker {
  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    bool allowCompression = false,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
  }) async {
    final data =
        jsonDecode(
              (await _pick(
                jsonEncode({
                  'allowMultiSelection': allowMultiple,
                  'allowedExtensions': allowedExtensions,
                }).toJS,
              ).toDart).toDart,
            )
            as List<dynamic>?;
    if (data == null) return null;
    return FilePickerResult(
      data.map((item) {
        final record = item as Map<String, dynamic>;
        final bytes = base64Decode(record['bytes'] as String);
        return PlatformFile(
          name: record['name'] as String,
          size: bytes.length,
          path: record['path'] as String,
          bytes: withData ? bytes : null,
          readStream: withReadStream ? Stream.value(bytes) : null,
        );
      }).toList(),
    );
  }

  @override
  Future<String?> saveFile({
    String? dialogTitle,
    String? fileName,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Uint8List? bytes,
    bool lockParentWindow = false,
  }) async {
    if (bytes == null)
      throw UnsupportedError('Browser saveFile requires file bytes');
    return saveBrowserFile(fileName ?? 'export.bin', bytes);
  }
}

class BrowserShare extends SharePlatform {
  @override
  Future<ShareResult> share(ShareParams params) async {
    final files = params.files ?? [];
    if (files.isEmpty) {
      final text = params.text ?? params.uri?.toString();
      if (text == null) throw ArgumentError('No share content');
      final path = await saveBrowserFile('bull-bitcoin.txt', utf8.encode(text));
      return ShareResult(
        path ?? '',
        path == null ? ShareResultStatus.dismissed : ShareResultStatus.success,
      );
    }
    for (var index = 0; index < files.length; index++) {
      final source = files[index];
      final file = File(source.path);
      final bytes = file.existsSync()
          ? file.readAsBytesSync()
          : await source.readAsBytes();
      final name = params.fileNameOverrides?[index] ?? source.name;
      final path = await saveBrowserFile(name, bytes);
      if (path == null)
        return const ShareResult('', ShareResultStatus.dismissed);
    }
    return const ShareResult('browser-file-export', ShareResultStatus.success);
  }
}

void registerBrowserFiles() {
  FilePicker.platform = BrowserFilePicker();
  SharePlatform.instance = BrowserShare();
}
