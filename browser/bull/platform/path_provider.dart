import 'io.dart';

Future<Directory> getApplicationCacheDirectory() =>
    Directory('/cache').create(recursive: true);
Future<Directory> getApplicationDocumentsDirectory() async =>
    Directory('/documents').create();
Future<Directory> getApplicationSupportDirectory() async =>
    Directory('/support').create();
Future<Directory> getTemporaryDirectory() async => Directory('/tmp').create();
Future<Directory?> getDownloadsDirectory() async =>
    Directory('/downloads').create();
