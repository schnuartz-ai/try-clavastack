import 'package:drift/drift.dart';
import 'package:drift/wasm.dart';
import 'io.dart' show browserIo;

QueryExecutor browserDatabase(String name) => LazyDatabase(() async {
  final session = browserIo('session', null) as String;
  final result = await WasmDatabase.open(
    databaseName: 'bull-bitcoin-$session-$name',
    sqlite3Uri: Uri.base.resolve('sqlite3.wasm'),
    driftWorkerUri: Uri.base.resolve('drift_worker.js'),
  );
  return result.resolvedExecutor;
});
