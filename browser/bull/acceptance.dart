// Test-only entry point. Never included in the production artifact.
// Loads the original app and opens its original PSBT screen with a public
// synthetic fixture; parsers, BLoCs, QR generation and finalization stay native.
import 'dart:js_interop';
import 'dart:convert';
import 'package:bb_mobile/main.dart' as original;
import 'package:bb_mobile/router.dart';
import 'package:bb_mobile/core/entities/signer_device_entity.dart';
import 'package:bb_mobile/features/psbt_flow/psbt_router.dart';
import 'package:bb_mobile/features/broadcast_signed_tx/presentation/broadcast_signed_tx_cubit.dart';
import 'package:bb_mobile/features/import_watch_only_wallet/presentation/cubit/import_watch_only_cubit.dart';
import 'package:bb_mobile/features/import_watch_only_wallet/presentation/cubit/import_watch_only_state.dart';
import 'package:bb_mobile/features/import_watch_only_wallet/import_watch_only_router.dart';
import 'package:bb_mobile/features/import_watch_only_wallet/domain/import_watch_only_failure.dart';
import 'package:bb_mobile/features/broadcast_signed_tx/presentation/broadcast_signed_tx_state.dart';
import 'package:bull_sdk/bdk.dart' as bdk;
import 'package:flutter_bloc/flutter_bloc.dart';

@JS('bullTestShowPsbt')
external set _showPsbt(JSFunction value);
@JS('bullTestState')
external set _state(JSFunction value);
@JS('bullTestWatchOnly')
external set _watchOnly(JSFunction value);

class PublicAcceptanceObserver extends BlocObserver {
  final Map<String, dynamic> state = {};
  @override
  void onChange(BlocBase<dynamic> bloc, Change<dynamic> change) {
    super.onChange(bloc, change);
    if (bloc is ImportWatchOnlyCubit) {
      final next = change.nextState as ImportWatchOnlyState;
      state['import'] = {
        'labelPresent': next.watchOnlyWallet?.label.isNotEmpty,
        'network': next.watchOnlyWallet?.network.name,
        'failure': switch (next.failure) {
          NetworkMismatchFailure() => 'networkMismatch',
          ImportFailedFailure() => 'importFailed',
          LabelRequiredFailure() => 'labelRequired',
          NoWalletSelectedFailure() => 'noWalletSelected',
          InvalidFormatFailure() => 'invalidFormat',
          null => null,
        },
        'imported': next.importedWallet != null,
      };
    }
    if (bloc is BroadcastSignedTxCubit) {
      final next = change.nextState as BroadcastSignedTxState;
      state['signed'] = {
        'hex': next.transaction?.data,
        'failure': next.failure?.runtimeType.toString(),
      };
    }
  }
}

Future<void> main() async {
  final observer = PublicAcceptanceObserver();
  Bloc.observer = observer;
  _state = (() => jsonEncode(observer.state).toJS).toJS;
  _watchOnly = (() {
    AppRouter.router.pushNamed(
      ImportWatchOnlyWalletRoutes.scan.name,
      extra: SignerDeviceEntity.specter,
    );
  }).toJS;
  _showPsbt = ((JSString psbt) {
    bdk.Psbt(
      psbtBase64: psbt.toDart,
    ); // The original native parser validates it.
    AppRouter.router.pushNamed(
      PsbtFlowRoutes.show.name,
      extra: (psbt: psbt.toDart, signerDevice: SignerDeviceEntity.specter),
    );
  }).toJS;
  await original.main();
  Bloc.observer = observer;
}
