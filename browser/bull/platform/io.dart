// Browser OS and session filesystem boundary. Native sockets remain unsupported
// dart:io APIs. No wallet parsing or cryptography belongs in this module.
import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';
export 'dart:io'
    hide Platform, File, Directory, FileSystemEntity, FileStat, IOSink;
import 'dart:io' show FileMode, FileSystemEntityType;

@JS('bullIo')
external JSString _io(JSString operation, JSString encoded);
dynamic browserIo(String operation, Object? data) =>
    jsonDecode(_io(operation.toJS, jsonEncode(data).toJS).toDart);

class Platform {
  static const bool isAndroid = false;
  static const bool isIOS = false;
  static const bool isWindows = false;
  static const bool isMacOS = false;
  static const bool isLinux = false;
  static const bool isFuchsia = false;
  static const String operatingSystem = 'web';
  static const String operatingSystemVersion = 'Browser';
  static const String version = 'Bull Bitcoin browser runtime';
  static const String pathSeparator = '/';
  static const int numberOfProcessors = 1;
  static const Map<String, String> environment = {};
  static const String executable = '';
  static const String resolvedExecutable = '';
  static const String localHostname = 'browser';
  static String get localeName => browserIo('locale', null) as String;
  static Uri get script => Uri.parse(browserIo('url', null) as String);
}

abstract class FileSystemEntity {
  final String path;
  FileSystemEntity(this.path);
  Uri get uri => Uri.file(path);
  Directory get parent => Directory(path.substring(0, path.lastIndexOf('/')));
  bool get isAbsolute => path.startsWith('/');
  FileSystemEntity get absolute => this;
  Future<bool> exists();
  bool existsSync();
  Future<FileSystemEntity> delete({bool recursive = false});
  void deleteSync({bool recursive = false});
  Future<FileStat> stat() async => statSync();
  FileStat statSync() => FileStat(
    this is Directory
        ? FileSystemEntityType.directory
        : FileSystemEntityType.file,
    this is File ? (this as File).lengthSync() : 0,
  );
  static Future<bool> isFile(String path) async => File(path).existsSync();
  static Future<bool> isDirectory(String path) async =>
      Directory(path).existsSync();
}

class FileStat {
  final FileSystemEntityType type;
  final int size;
  FileStat(this.type, this.size);
  DateTime get modified => DateTime.now();
  DateTime get changed => modified;
  DateTime get accessed => modified;
  int get mode => 0;
}

class File extends FileSystemEntity {
  File(super.path);
  File.fromUri(Uri uri) : super(uri.toFilePath());
  @override
  File get absolute => this;
  @override
  bool existsSync() => browserIo('exists', path) as bool;
  @override
  Future<bool> exists() async => existsSync();
  Future<File> create({bool recursive = false, bool exclusive = false}) async {
    if (!existsSync()) writeAsBytesSync([]);
    return this;
  }

  File createSync({bool recursive = false, bool exclusive = false}) {
    if (!existsSync()) writeAsBytesSync([]);
    return this;
  }

  Uint8List readAsBytesSync() =>
      base64Decode(browserIo('read', path) as String);
  Future<Uint8List> readAsBytes() async => readAsBytesSync();
  String readAsStringSync({Encoding encoding = utf8}) =>
      encoding.decode(readAsBytesSync());
  Future<String> readAsString({Encoding encoding = utf8}) async =>
      readAsStringSync(encoding: encoding);
  List<String> readAsLinesSync({Encoding encoding = utf8}) =>
      const LineSplitter().convert(readAsStringSync(encoding: encoding));
  Future<List<String>> readAsLines({Encoding encoding = utf8}) async =>
      readAsLinesSync(encoding: encoding);
  File writeAsBytesSync(
    List<int> bytes, {
    FileMode mode = FileMode.write,
    bool flush = false,
  }) {
    final data = mode == FileMode.append && existsSync()
        ? [...readAsBytesSync(), ...bytes]
        : bytes;
    browserIo('write', {'path': path, 'bytes': base64Encode(data)});
    return this;
  }

  Future<File> writeAsBytes(
    List<int> bytes, {
    FileMode mode = FileMode.write,
    bool flush = false,
  }) async => writeAsBytesSync(bytes, mode: mode, flush: flush);
  File writeAsStringSync(
    String data, {
    FileMode mode = FileMode.write,
    Encoding encoding = utf8,
    bool flush = false,
  }) => writeAsBytesSync(encoding.encode(data), mode: mode, flush: flush);
  Future<File> writeAsString(
    String data, {
    FileMode mode = FileMode.write,
    Encoding encoding = utf8,
    bool flush = false,
  }) async =>
      writeAsStringSync(data, mode: mode, encoding: encoding, flush: flush);
  int lengthSync() => readAsBytesSync().length;
  Future<int> length() async => lengthSync();
  Stream<List<int>> openRead([int? start, int? end]) async* {
    final bytes = readAsBytesSync();
    yield bytes.sublist(start ?? 0, end ?? bytes.length);
  }

  IOSink openWrite({
    FileMode mode = FileMode.write,
    Encoding encoding = utf8,
  }) => IOSink(this, mode, encoding);
  @override
  void deleteSync({bool recursive = false}) => browserIo('delete', path);
  @override
  Future<File> delete({bool recursive = false}) async {
    deleteSync(recursive: recursive);
    return this;
  }

  Future<File> copy(String newPath) async =>
      File(newPath).writeAsBytes(readAsBytesSync());
  Future<File> rename(String newPath) async {
    final next = await copy(newPath);
    deleteSync();
    return next;
  }

  DateTime lastModifiedSync() => DateTime.fromMillisecondsSinceEpoch(
    browserIo('modified', path) as int? ?? 0,
  );
  Future<DateTime> lastModified() async => lastModifiedSync();
}

class Directory extends FileSystemEntity {
  Directory(super.path);
  Directory.fromUri(Uri uri) : super(uri.toFilePath());
  static Directory get systemTemp => Directory('/tmp');
  static Directory get current => Directory('/documents');
  @override
  Directory get absolute => this;
  @override
  bool existsSync() => browserIo('directoryExists', path) as bool;
  @override
  Future<bool> exists() async => existsSync();
  Directory createSync({bool recursive = false}) {
    browserIo('mkdir', path);
    return this;
  }

  Future<Directory> create({bool recursive = false}) async =>
      createSync(recursive: recursive);
  Future<Directory> createTemp([String? prefix]) async => Directory(
    '$path/${prefix ?? ''}${DateTime.now().microsecondsSinceEpoch}',
  ).create();
  List<FileSystemEntity> listSync({
    bool recursive = false,
    bool followLinks = true,
  }) => (browserIo('list', path) as List<dynamic>)
      .map((p) => File(p as String))
      .toList();
  Stream<FileSystemEntity> list({
    bool recursive = false,
    bool followLinks = true,
  }) => Stream.fromIterable(listSync(recursive: recursive));
  @override
  void deleteSync({bool recursive = false}) => browserIo('rmdir', path);
  @override
  Future<Directory> delete({bool recursive = false}) async {
    deleteSync(recursive: recursive);
    return this;
  }
}

class IOSink implements StreamSink<List<int>> {
  final File file;
  final FileMode mode;
  Encoding encoding;
  final List<int> _bytes = [];
  bool _flushed = false;
  IOSink(this.file, this.mode, this.encoding);
  @override
  void add(List<int> data) => _bytes.addAll(data);
  void write(Object? value) => add(encoding.encode(value.toString()));
  void writeln([Object? value = '']) => write('$value\n');
  void writeAll(Iterable<Object?> values, [String separator = '']) =>
      write(values.join(separator));
  @override
  void addError(Object error, [StackTrace? stackTrace]) => throw error;
  @override
  Future<void> addStream(Stream<List<int>> stream) async {
    await for (final bytes in stream) {
      add(bytes);
    }
  }

  Future<void> flush() async {
    if (_flushed && _bytes.isEmpty) return;
    await file.writeAsBytes(_bytes, mode: _flushed ? FileMode.append : mode);
    _bytes.clear();
    _flushed = true;
  }

  @override
  Future<void> close() async => flush();
  @override
  Future<void> get done => Future<void>.value();
}
